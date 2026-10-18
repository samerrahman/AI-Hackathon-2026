import {
  WALL_HOLD_ID,
  type BetaStep,
  type Brief,
  type Candidate,
  type DetectedHold,
  type Placement,
  type PlacementRole,
  type RouteResponse,
  type ValidatedCandidate,
} from "./schema";

export const MIN_PLACEMENTS = 5;
export const MAX_PLACEMENTS = 9;
export const CANDIDATE_COUNT = 3;

export const FORERUN_WARNING =
  "Concept only — requires professional installation, human forerunning and inspection before anyone climbs it.";

const HAND_ROLES: ReadonlySet<PlacementRole> = new Set<PlacementRole>(["start", "hand", "finish"]);

/** Rough "extremely far" threshold for consecutive hand holds: 60% of climber height. */
export function reachLimitMeters(climberHeightCm: number): number {
  return (climberHeightCm / 100) * 0.6;
}

/** Distance between two placements in metres, using the stated wall dimensions. */
export function placementDistanceM(a: Placement, b: Placement, brief: Brief): number {
  const dx = ((b.xPercent - a.xPercent) / 100) * brief.wallWidthM;
  const dy = ((b.yPercent - a.yPercent) / 100) * brief.wallHeightM;
  return Math.hypot(dx, dy);
}

const SAFETY_PATTERNS: Array<[RegExp, string]> = [
  [/\bcertif(?:ied|y|ication)\b/gi, "unverified"],
  [/\bguaranteed\b/gi, "intended"],
  [/\bsafe(?:ly|st|r)?\b/gi, "lower-risk (unverified)"],
];

/** Remove any language that claims a route is certified or safe. */
export function scrubSafetyClaims(text: string): { text: string; changed: boolean } {
  let out = text;
  for (const [re, replacement] of SAFETY_PATTERNS) out = out.replace(re, replacement);
  return { text: out, changed: out !== text };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function lastIndexWhere<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

function normalizeConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0;
  const v = c > 1 && c <= 100 ? c / 100 : c;
  return Math.round(clamp(v, 0, 1) * 100) / 100;
}

const roleRank = (r: PlacementRole) => (r === "start" ? 0 : r === "finish" ? 2 : 1);

/**
 * Deterministic checks and repairs for one route candidate.
 * Never trusts the generator: coordinates, hold references, counts and safety
 * language are all re-checked here.
 */
export function validateCandidate(
  input: Candidate,
  knownHoldIds: ReadonlySet<string>,
  brief: Brief,
): ValidatedCandidate {
  const notes: string[] = [];
  const errors: string[] = [];
  const flags = { scrubbed: false };

  // 1. Known holds + coordinate repair.
  let placements: Placement[] = [];
  for (const p of input.placements) {
    if (!knownHoldIds.has(p.holdId)) {
      notes.push(`Removed placement of unknown hold "${p.holdId}".`);
      continue;
    }
    if (!Number.isFinite(p.xPercent) || !Number.isFinite(p.yPercent)) {
      notes.push(`Removed ${p.holdId}: coordinates were not numbers.`);
      continue;
    }
    const x = clamp(p.xPercent, 0, 100);
    const y = clamp(p.yPercent, 0, 100);
    if (x !== p.xPercent || y !== p.yPercent) {
      notes.push(`Clamped ${p.holdId} into the 0–100 wall frame.`);
    }
    const rot = Number.isFinite(p.rotationDegrees) ? ((p.rotationDegrees % 360) + 360) % 360 : 0;
    placements.push({
      ...p,
      xPercent: round1(x),
      yPercent: round1(y),
      rotationDegrees: Math.round(rot),
    });
  }

  // 2. One physical hold can only be used once per route.
  placements.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const seen = new Set<string>();
  placements = placements.filter((p) => {
    if (seen.has(p.holdId)) {
      notes.push(`Removed duplicate use of ${p.holdId}; a physical hold can only be placed once.`);
      return false;
    }
    seen.add(p.holdId);
    return true;
  });

  // 3. Require a start and a finish (repair when possible).
  if (placements.length >= 2) {
    if (!placements.some((p) => p.role === "start")) {
      let pool = placements.filter((p) => p.role === "hand");
      if (!pool.length) pool = placements.filter((p) => p.role !== "finish");
      if (pool.length) {
        const lowest = pool.reduce((a, b) => (b.yPercent > a.yPercent ? b : a));
        lowest.role = "start";
        notes.push(`No start hold given; marked ${lowest.holdId} (lowest hand hold) as the start.`);
      }
    }
    if (!placements.some((p) => p.role === "finish")) {
      let pool = placements.filter((p) => p.role === "hand");
      if (!pool.length) pool = placements.filter((p) => p.role !== "start");
      if (pool.length) {
        const highest = pool.reduce((a, b) => (b.yPercent < a.yPercent ? b : a));
        highest.role = "finish";
        notes.push(`No finish hold given; marked ${highest.holdId} (highest hand hold) as the finish.`);
      }
    }
  }

  // Start(s) first, finish last, everything else in the generator's order.
  placements.sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.sequenceNumber - b.sequenceNumber);

  // 4. 5–9 placements.
  while (placements.length > MAX_PLACEMENTS) {
    let idx = lastIndexWhere(placements, (p) => p.role === "foot");
    if (idx < 0) idx = lastIndexWhere(placements, (p) => p.role === "hand");
    if (idx < 0) break;
    const [removed] = placements.splice(idx, 1);
    notes.push(`Trimmed ${removed.holdId} to respect the ${MAX_PLACEMENTS}-placement limit.`);
  }
  if (placements.length < MIN_PLACEMENTS) {
    errors.push(
      `Only ${placements.length} usable placement(s); a route needs ${MIN_PLACEMENTS}–${MAX_PLACEMENTS}.`,
    );
  }
  if (!placements.some((p) => p.role === "start")) errors.push("Route has no start hold.");
  if (!placements.some((p) => p.role === "finish")) errors.push("Route has no finish hold.");

  placements = placements.map((p, i) => ({ ...p, sequenceNumber: i + 1 }));

  // 5. Reach check between consecutive hand holds.
  const warnings: string[] = [];
  const limit = reachLimitMeters(brief.climberHeightCm);
  const hands = placements.filter((p) => HAND_ROLES.has(p.role));
  for (let i = 1; i < hands.length; i++) {
    const a = hands[i - 1];
    const b = hands[i];
    if (a.role === "start" && b.role === "start") continue;
    const d = placementDistanceM(a, b, brief);
    if (d > limit) {
      const dynoNote = brief.requiredMove === "dyno" ? " May be the intended dyno — forerun to confirm." : "";
      warnings.push(
        `Reach check: ${a.holdId} → ${b.holdId} is ~${d.toFixed(2)} m, beyond the ~${limit.toFixed(2)} m limit for a ${brief.climberHeightCm} cm climber.${dynoNote}`,
      );
    }
  }

  // 6. Beta steps must reference holds in this route (or blank wall).
  const routeIds = new Set(placements.map((p) => p.holdId));
  const beta: BetaStep[] = [];
  for (const s of [...input.beta].sort((a, b) => a.step - b.step)) {
    if (s.holdId !== WALL_HOLD_ID && !routeIds.has(s.holdId)) {
      notes.push(`Removed beta step ${s.step}: ${s.holdId} is not part of this route.`);
      continue;
    }
    beta.push({ ...s });
  }
  if (!beta.length) warnings.push("No usable beta steps — the setter must define the intended sequence.");

  // 7. Safety language.
  const scrub = (t: string) => {
    const r = scrubSafetyClaims(t);
    if (r.changed) flags.scrubbed = true;
    return r.text;
  };
  const cleanBeta = beta.map((s, i) => ({
    ...s,
    step: i + 1,
    movement: scrub(s.movement),
    explanation: scrub(s.explanation),
  }));
  const name = scrub(input.name);
  const crux = scrub(input.crux);
  const rationale = scrub(input.rationale);
  const style = scrub(input.style);
  const modelWarnings = input.warnings.map(scrub);
  if (flags.scrubbed) notes.push("Removed language claiming the route is safe or certified.");

  const allWarnings = Array.from(new Set([...modelWarnings, ...warnings, FORERUN_WARNING])).filter(
    (w) => w.trim().length > 0,
  );

  const status = errors.length ? "invalid" : notes.length ? "repaired" : "ok";

  return {
    ...input,
    name,
    crux,
    rationale,
    style,
    confidence: normalizeConfidence(input.confidence),
    placements,
    beta: cleanBeta,
    warnings: allWarnings,
    validation: { status, notes: [...errors, ...notes] },
  };
}

/** Validate a whole generator response: hold inventory + candidates. */
export function validateRouteResponse(
  raw: RouteResponse,
  brief: Brief,
): { detectedHolds: DetectedHold[]; candidates: ValidatedCandidate[]; notices: string[] } {
  const notices: string[] = [];

  const holdMap = new Map<string, DetectedHold>();
  for (const h of raw.detectedHolds) {
    const id = h.id.trim();
    if (!id || holdMap.has(id)) continue;
    holdMap.set(id, {
      ...h,
      id,
      confidence: normalizeConfidence(h.confidence),
      xPercent: round1(clamp(h.xPercent, 0, 100)),
      yPercent: round1(clamp(h.yPercent, 0, 100)),
    });
  }
  const detectedHolds = Array.from(holdMap.values());
  if (!detectedHolds.length) notices.push("No holds were detected in the inventory photo.");

  let candidates = raw.candidates;
  if (candidates.length > CANDIDATE_COUNT) {
    notices.push(`Generator returned ${candidates.length} candidates; kept the first ${CANDIDATE_COUNT}.`);
    candidates = candidates.slice(0, CANDIDATE_COUNT);
  } else if (candidates.length < CANDIDATE_COUNT) {
    notices.push(`Expected ${CANDIDATE_COUNT} candidates but received ${candidates.length}.`);
  }

  const ids = new Set(detectedHolds.map((h) => h.id));
  return {
    detectedHolds,
    candidates: candidates.map((c) => validateCandidate(c, ids, brief)),
    notices,
  };
}
