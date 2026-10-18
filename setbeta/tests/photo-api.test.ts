import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSampleRoutes, SAMPLE_HOLDS } from "../lib/sampleGenerator";
import type { Brief, WallBoundary } from "../lib/schema";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({ default: class { responses = { create }; } }));

const brief: Brief = {
  wallWidthM: 3.5, wallHeightM: 4, wallAngleDeg: 20, grade: "V4",
  style: "technical", requiredMove: "heel hook", climberHeightCm: 170, notes: "",
};
const boundary: WallBoundary = [
  { xPercent: 10, yPercent: 10 }, { xPercent: 90, yPercent: 10 },
  { xPercent: 90, yPercent: 90 }, { xPercent: 10, yPercent: 90 },
];
const image = "data:image/jpeg;base64,AA==";
const originalKey = process.env.OPENAI_API_KEY;
const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeAll(() => { process.env.OPENAI_API_KEY = "sk-test-secret"; });
afterAll(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});
beforeEach(() => { create.mockReset(); });

describe("photo APIs", () => {
  it("analyzes only the hold image and returns a numbered inventory", async () => {
    create.mockResolvedValueOnce({ output_text: JSON.stringify({ detectedHolds: SAMPLE_HOLDS.slice(0, 5) }) });
    const { POST } = await import("../app/api/analyze-holds/route");
    const response = await POST(post("/api/analyze-holds", { holdsImage: image }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.detectedHolds.map((hold: { id: string }) => hold.id)).toEqual(["H1", "H2", "H3", "H4", "H5"]);
    const input = create.mock.calls[0][0].input[0].content;
    expect(input.filter((part: { type: string }) => part.type === "input_image")).toHaveLength(1);
  });

  it("reports API failures without a sample route or sensitive data", async () => {
    create.mockRejectedValueOnce(new Error(`sk-test-secret ${image}`));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { POST } = await import("../app/api/generate/route");
      const response = await POST(post("/api/generate", { brief, workflow: "photo", inventory: SAMPLE_HOLDS, wallImage: image, wallBoundary: boundary }));
      const data = await response.json();
      expect(response.status).toBe(502);
      expect(data.category).toBe("api_request");
      expect(data).not.toHaveProperty("candidates");
      expect(JSON.stringify(data) + JSON.stringify(log.mock.calls)).not.toMatch(/sk-test-secret|data:image/);
    } finally { log.mockRestore(); }
  });

  it("distinguishes response schema and route validation failures", async () => {
    const { POST } = await import("../app/api/generate/route");
    const payload = { brief, workflow: "photo", inventory: SAMPLE_HOLDS, wallImage: image, wallBoundary: boundary };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      create.mockResolvedValueOnce({ output_text: "{}" });
      const malformed = await POST(post("/api/generate", payload));
      expect((await malformed.json()).category).toBe("response_schema");
      const incomplete = generateSampleRoutes(brief).candidates.slice(0, 2);
      create.mockResolvedValueOnce({ output_text: JSON.stringify({ candidates: incomplete }) });
      const invalid = await POST(post("/api/generate", payload));
      expect(invalid.status).toBe(422);
      expect((await invalid.json()).category).toBe("route_validation");
    } finally { log.mockRestore(); }
  });

  it("reports missing photo data as image processing failure", async () => {
    const { POST } = await import("../app/api/generate/route");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(post("/api/generate", { brief, workflow: "photo", inventory: SAMPLE_HOLDS, wallBoundary: boundary }));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.category).toBe("image_processing");
      expect(data).not.toHaveProperty("candidates");
    } finally { log.mockRestore(); }
  });

  it("returns samples only when explicitly requested", async () => {
    const { POST } = await import("../app/api/generate/route");
    const response = await POST(post("/api/generate", { brief, workflow: "photo", forceSample: true }));
    const data = await response.json();
    expect(data.mode).toBe("sample");
    expect(data.candidates).toHaveLength(3);
    expect(create).not.toHaveBeenCalled();
  });
});
