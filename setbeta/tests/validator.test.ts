import { describe, expect, it } from "vitest";
import { generateSampleRoutes, SAMPLE_HOLDS } from "../lib/sampleGenerator";
import { GRADES, RouteResponseSchema, type Brief, type Candidate } from "../lib/schema";
import {
  FORERUN_WARNING,
  MAX_PLACEMENTS,
  MIN_PLACEMENTS,
  placementDistanceM,
  validateCandidate,
  validateRouteResponse,
} from "../lib/validator";

const brief: Brief = {
  wallWidthM: 3.5,
  wallHeightM: 4,
  wallAngleDeg: 20,
  grade: "V4",
  style: "technical",
  requiredMove: "heel hook",
  climberHeightCm: 170,
  notes: "",
};

const knownIds = new Set(SAMPLE_HOLDS.map((h) => h.id));

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    name: "Test line",
    targetGrade: "V4",
    estimatedGradeLow: "V3",
    estimatedGradeHigh: "V5",
    confidence: 0.5,
    style: "technical",
    placements: [
      { sequenceNumber: 1, holdId: "H2", xPercent: 50, yPercent: 70, rotationDegrees: 0, role: "start" },
      { sequenceNumber: 2, holdId: "H10", xPercent: 45, yPercent: 90, rotationDegrees: 0, role: "foot" },
      { sequenceNumber: 3, holdId: "H5", xPercent: 55, yPercent: 55, rotationDegrees: 0, role: "hand" },
      { sequenceNumber: 4, holdId: "H8", xPercent: 45, yPercent: 40, rotationDegrees: 90, role: "hand" },
      { sequenceNumber: 5, holdId: "H7", xPercent: 55, yPercent: 25, rotationDegrees: 0, role: "hand" },
      { sequenceNumber: 6, holdId: "H11", xPercent: 50, yPercent: 10, rotationDegrees: 0, role: "finish" },
    ],
    beta: [
      { step: 1, limb: "both hands", holdId: "H2", movement: "Start", explanation: "Match the start." },
      { step: 2, limb: "right hand", holdId: "H5", movement: "Reach", explanation: "Reach to the edge." },
      { step: 3, limb: "right heel", holdId: "H8", movement: "Heel hook", explanation: "Heel hook." },
    ],
    crux: "Heel hook on H8 to H7",
    rationale: "A test route.",
    warnings: [],
    ...overrides,
  };
}

describe("validateCandidate", () => {
  it("accepts a well-formed candidate and always adds the forerunning warning", () => {
    const v = validateCandidate(makeCandidate(), knownIds, brief);
    expect(v.validation.status).toBe("ok");
    expect(v.placements).toHaveLength(6);
    expect(v.warnings).toContain(FORERUN_WARNING);
  });

  it("clamps coordinates outside 0–100", () => {
    const c = makeCandidate();
    c.placements[2] = { ...c.placements[2], xPercent: 130, yPercent: -12 };
    const v = validateCandidate(c, knownIds, brief);
    const p = v.placements.find((x) => x.holdId === "H5")!;
    expect(p.xPercent).toBe(100);
    expect(p.yPercent).toBe(0);
    expect(v.validation.status).toBe("repaired");
    for (const q of v.placements) {
      expect(q.xPercent).toBeGreaterThanOrEqual(0);
      expect(q.xPercent).toBeLessThanOrEqual(100);
      expect(q.yPercent).toBeGreaterThanOrEqual(0);
      expect(q.yPercent).toBeLessThanOrEqual(100);
    }
  });

  it("never uses the same physical hold twice in one route", () => {
    const c = makeCandidate();
    c.placements[4] = { ...c.placements[4], holdId: "H5" };
    const v = validateCandidate(c, knownIds, brief);
    const ids = v.placements.map((p) => p.holdId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "H5")).toHaveLength(1);
  });

  it("repairs a missing start and finish", () => {
    const c = makeCandidate();
    c.placements = c.placements.map((p) => (p.role === "foot" ? p : { ...p, role: "hand" as const }));
    const v = validateCandidate(c, knownIds, brief);
    expect(v.placements.find((p) => p.role === "start")?.holdId).toBe("H2");
    expect(v.placements.find((p) => p.role === "finish")?.holdId).toBe("H11");
    expect(v.placements[0].role).toBe("start");
    expect(v.placements[v.placements.length - 1].role).toBe("finish");
  });

  it("marks routes with fewer than 5 placements invalid and trims routes over 9", () => {
    const short = makeCandidate();
    short.placements = short.placements.slice(0, 3);
    expect(validateCandidate(short, knownIds, brief).validation.status).toBe("invalid");

    const long = makeCandidate();
    const extra = ["H1", "H3", "H4", "H6", "H9", "H12"].map((id, i) => ({
      sequenceNumber: 10 + i,
      holdId: id,
      xPercent: 20 + i * 10,
      yPercent: 60,
      rotationDegrees: 0,
      role: "foot" as const,
    }));
    long.placements = [...long.placements, ...extra];
    const v = validateCandidate(long, knownIds, brief);
    expect(v.placements.length).toBeLessThanOrEqual(MAX_PLACEMENTS);
    expect(v.placements.length).toBeGreaterThanOrEqual(MIN_PLACEMENTS);
  });

  it("drops placements and beta steps that reference unknown holds", () => {
    const c = makeCandidate();
    c.placements.push({ sequenceNumber: 7, holdId: "H99", xPercent: 30, yPercent: 30, rotationDegrees: 0, role: "hand" });
    c.beta.push({ step: 4, limb: "left hand", holdId: "H99", movement: "Reach", explanation: "Ghost hold." });
    const v = validateCandidate(c, knownIds, brief);
    expect(v.placements.some((p) => p.holdId === "H99")).toBe(false);
    expect(v.beta.some((s) => s.holdId === "H99")).toBe(false);
    expect(v.validation.notes.join(" ")).toMatch(/H99/);
  });

  it("warns when consecutive hand placements are extremely far apart", () => {
    const c = makeCandidate();
    // H5 at (55,55) → H8 at (5,40): ~1.8 m horizontally on a 3.5 m wall.
    c.placements[3] = { ...c.placements[3], xPercent: 5, yPercent: 40 };
    const v = validateCandidate(c, knownIds, brief);
    expect(v.warnings.some((w) => w.startsWith("Reach check: H5 → H8"))).toBe(true);
  });

  it("removes claims that a route is safe or certified", () => {
    const c = makeCandidate({
      rationale: "This route is certified and completely safe.",
      warnings: ["Totally safe for kids."],
    });
    const v = validateCandidate(c, knownIds, brief);
    const text = [v.rationale, ...v.warnings, v.crux, ...v.beta.map((s) => s.explanation)].join(" ");
    expect(text).not.toMatch(/\bcertified\b/i);
    expect(text).not.toMatch(/\bsafe\b/i);
    expect(v.validation.notes.join(" ")).toMatch(/safe or certified/);
  });
});

describe("sample generator + validateRouteResponse", () => {
  it("keeps inventory photo labels inside the image frame", () => {
    const raw = generateSampleRoutes(brief);
    expect(RouteResponseSchema.safeParse(raw).success).toBe(true);
    raw.detectedHolds[0] = { ...raw.detectedHolds[0], xPercent: -10, yPercent: 120 };
    const out = validateRouteResponse(raw, brief);
    expect(out.detectedHolds[0].xPercent).toBe(0);
    expect(out.detectedHolds[0].yPercent).toBe(100);
  });

  it("produces three valid candidates for every grade V0–V7", () => {
    for (const grade of GRADES) {
      const b: Brief = { ...brief, grade };
      const out = validateRouteResponse(generateSampleRoutes(b), b);
      expect(out.candidates).toHaveLength(3);
      for (const c of out.candidates) {
        expect(c.validation.status).not.toBe("invalid");
        expect(c.placements.length).toBeGreaterThanOrEqual(MIN_PLACEMENTS);
        expect(c.placements.length).toBeLessThanOrEqual(MAX_PLACEMENTS);
        expect(c.placements.filter((p) => p.role === "start").length).toBeGreaterThan(0);
        expect(c.placements.filter((p) => p.role === "finish")).toHaveLength(1);
        expect(c.warnings).toContain(FORERUN_WARNING);
      }
    }
  });

  it("is deterministic and responds to grade changes", () => {
    const a = generateSampleRoutes(brief);
    const b = generateSampleRoutes(brief);
    expect(a).toEqual(b);
    const v1 = generateSampleRoutes({ ...brief, grade: "V1" });
    const v7 = generateSampleRoutes({ ...brief, grade: "V7" });
    expect(v1.candidates[0].placements).not.toEqual(v7.candidates[0].placements);
    expect(v1.candidates[0].estimatedGradeHigh).not.toEqual(v7.candidates[0].estimatedGradeHigh);
  });

  it("makes hand moves shorter for a shorter climber asking for a less reachy crux", () => {
    const avgHandMove = (b: Brief) => {
      const { candidates } = validateRouteResponse(generateSampleRoutes(b), b);
      const ds: number[] = [];
      for (const c of candidates) {
        const hands = c.placements.filter((p) => p.role !== "foot");
        for (let i = 1; i < hands.length; i++) ds.push(placementDistanceM(hands[i - 1], hands[i], b));
      }
      return ds.reduce((s, d) => s + d, 0) / ds.length;
    };
    const base = avgHandMove(brief);
    const adapted = avgHandMove({ ...brief, climberHeightCm: 160, notes: "Keep the heel hook but make the crux less reachy" });
    expect(adapted).toBeLessThan(base);
  });
});
