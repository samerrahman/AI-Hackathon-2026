/**
 * Deterministic sample route generator.
 *
 * Used when no OpenAI key is configured (or as a fallback) so the demo always
 * works. It is hand-authored setting heuristics, not learned biomechanics:
 *   - grade + climber height + style -> hand-move spacing
 *   - grade tier + style            -> preferred hold types
 *   - required move                  -> a featured crux geometry + beta step
 * Same inputs always give the same output.
 */
import {
  WALL_HOLD_ID,
  gradeToNumber,
  type BetaStep,
  type Brief,
  type Candidate,
  type DetectedHold,
  type HoldSize,
  type HoldType,
  type Limb,
  type Placement,
  type PlacementRole,
  type RequiredMove,
  type RouteResponse,
  type Style,
} from "./schema";
import { reachLimitMeters } from "./validator";

/** Matches public/sample-holds.svg (reading order). */
export const SAMPLE_HOLDS: DetectedHold[] = [
  { id: "H1", apparentType: "jug", relativeSize: "large", confidence: 0.95, xPercent: 11, yPercent: 20.3 },
  { id: "H2", apparentType: "jug", relativeSize: "medium", confidence: 0.92, xPercent: 30, yPercent: 20.3 },
  { id: "H3", apparentType: "crimp", relativeSize: "small", confidence: 0.88, xPercent: 49, yPercent: 20.3 },
  { id: "H4", apparentType: "crimp", relativeSize: "small", confidence: 0.85, xPercent: 68, yPercent: 20.3 },
  { id: "H5", apparentType: "edge", relativeSize: "medium", confidence: 0.9, xPercent: 87, yPercent: 20.3 },
  { id: "H6", apparentType: "sloper", relativeSize: "large", confidence: 0.87, xPercent: 11, yPercent: 46.9 },
  { id: "H7", apparentType: "pinch", relativeSize: "medium", confidence: 0.83, xPercent: 30, yPercent: 46.9 },
  { id: "H8", apparentType: "sidepull", relativeSize: "medium", confidence: 0.86, xPercent: 49, yPercent: 46.9 },
  { id: "H9", apparentType: "undercling", relativeSize: "medium", confidence: 0.8, xPercent: 68, yPercent: 46.9 },
  { id: "H10", apparentType: "foothold", relativeSize: "small", confidence: 0.9, xPercent: 87, yPercent: 46.9 },
  { id: "H11", apparentType: "jug", relativeSize: "extra-large", confidence: 0.94, xPercent: 11, yPercent: 73.4 },
  { id: "H12", apparentType: "edge", relativeSize: "medium", confidence: 0.84, xPercent: 30, yPercent: 73.4 },
  { id: "H13", apparentType: "pinch", relativeSize: "large", confidence: 0.82, xPercent: 49, yPercent: 73.4 },
  { id: "H14", apparentType: "foothold", relativeSize: "small", confidence: 0.89, xPercent: 68, yPercent: 73.4 },
  { id: "H15", apparentType: "foothold", relativeSize: "small", confidence: 0.87, xPercent: 87, yPercent: 73.4 },
];

// ---------- Seeded randomness ----------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Setting heuristics (hand-authored) ----------

type Tier = "easy" | "mid" | "hard";
const tierFor = (g: number): Tier => (g <= 2 ? "easy" : g <= 5 ? "mid" : "hard");

type TypeWeights = Partial<Record<HoldType, number>>;

const GRADE_PREFS: Record<Tier, TypeWeights> = {
  easy: { jug: 3, edge: 2, sidepull: 1.5, pinch: 1.2, undercling: 1, sloper: 0.4, crimp: 0.2 },
  mid: { edge: 2.2, pinch: 2, sidepull: 2, crimp: 1.5, undercling: 1.4, sloper: 1.3, jug: 1 },
  hard: { crimp: 2.6, sloper: 2.4, pinch: 2.2, sidepull: 1.6, undercling: 1.6, edge: 1.2, jug: 0.3 },
};

const STYLE_PREFS: Record<Style, TypeWeights> = {
  technical: { crimp: 1, edge: 1, sidepull: 0.8, pinch: 0.6 },
  powerful: { sloper: 1, pinch: 1, undercling: 0.8 },
  dynamic: { jug: 1, edge: 0.6, sloper: 0.4 },
  balancy: { edge: 0.8, sloper: 0.8, pinch: 0.6, undercling: 0.6 },
  flowy: { jug: 0.8, sidepull: 1, edge: 0.6 },
};

const STYLE_STEP: Record<Style, number> = {
  technical: 0.95,
  powerful: 1.08,
  dynamic: 1.12,
  balancy: 0.92,
  flowy: 0.9,
};

const SIZE_SCORE: Record<HoldSize, number> = { small: 0, medium: 1, large: 2, "extra-large": 3 };

/** Hold types that suit the featured move, best first. */
const MOVE_FEATURE: Partial<Record<RequiredMove, HoldType[]>> = {
  "heel hook": ["jug", "sidepull", "pinch", "sloper"],
  "toe hook": ["jug", "pinch", "sidepull"],
  "drop knee": ["sidepull", "undercling", "pinch"],
  gaston: ["sidepull", "pinch"],
  compression: ["pinch", "sloper"],
  deadpoint: ["edge", "jug"],
  dyno: ["jug"],
  flag: ["sidepull", "edge"],
};

const GRIP_HINT: Record<HoldType, string> = {
  jug: "positive — a chance to shake out",
  crimp: "small — half-crimp and keep the feet quiet",
  edge: "open-hand drag on the edge",
  pinch: "squeeze with the thumb engaged",
  sloper: "keep arms straight and hips under the hold",
  sidepull: "lean off it to load the side",
  undercling: "get the feet up and stand into it",
  pocket: "pick the strongest finger combination",
  foothold: "precise toe placement",
  volume: "use the angle of the volume",
  unknown: "confirm the grip on the real hold",
};

interface Line {
  name: string;
  x: (t: number) => number;
}

const LINES: Line[] = [
  { name: "Centre Line", x: (t) => 50 + 6 * Math.sin(t * Math.PI * 1.5) },
  { name: "Rising Diagonal", x: (t) => 30 + 40 * t },
  { name: "Traverse In", x: (t) => 74 - 40 * Math.pow(t, 0.8) },
];

const GRADE_RANGE_OFFSETS: Array<[number, number]> = [
  [-1, 0],
  [0, 1],
  [-1, 1],
];

function notesReachFactor(notes: string): number {
  const n = notes.toLowerCase();
  if (
    /less\s+reach|less\s+reachy|not\s+(as|so)\s+reachy|shorter\s+(climber|moves)|smaller\s+moves|more\s+compact|reduce\s+(the\s+)?reach/.test(
      n,
    )
  )
    return 0.85;
  if (/more\s+reach|reachier|bigger\s+moves|longer\s+moves|bigger\s+span/.test(n)) return 1.15;
  return 1;
}

// ---------- Helpers ----------

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

class Inventory {
  private remaining: DetectedHold[];
  constructor(holds: DetectedHold[]) {
    this.remaining = holds.filter((h) => h.apparentType !== "volume");
  }
  take(score: (h: DetectedHold) => number): DetectedHold | null {
    if (!this.remaining.length) return null;
    let best = this.remaining[0];
    let bestScore = score(best);
    for (const h of this.remaining.slice(1)) {
      const s = score(h);
      if (s > bestScore) {
        best = h;
        bestScore = s;
      }
    }
    this.remaining = this.remaining.filter((h) => h !== best);
    return best;
  }
}

interface HandSlot {
  x: number;
  y: number;
  holdId: string | null;
  role: PlacementRole;
}
interface FootSlot {
  x: number;
  y: number;
  holdId: string | null;
  high: boolean;
}

function rotationFor(type: HoldType, x: number, lineX: number, rng: () => number): number {
  const j = (rng() - 0.5) * 20;
  let r: number;
  switch (type) {
    case "sidepull":
      // Edge faces toward the line so the climber leans off it.
      r = x > lineX ? 90 + j : 270 + j;
      break;
    case "undercling":
      r = 180 + j;
      break;
    case "foothold":
      r = 0;
      break;
    default:
      r = j * 1.5;
  }
  return Math.round(((r % 360) + 360) % 360);
}

function featureIndexFor(move: RequiredMove, crux: number): number | null {
  switch (move) {
    case "heel hook":
    case "toe hook":
    case "drop knee":
      return crux - 1;
    case "gaston":
    case "deadpoint":
    case "dyno":
    case "flag":
    case "compression":
      return crux;
    default:
      return null;
  }
}

// ---------- Generator ----------

export function generateSampleRoutes(
  brief: Brief,
  inventory: DetectedHold[] = SAMPLE_HOLDS,
): RouteResponse {
  return {
    detectedHolds: inventory.map((h) => ({ ...h })),
    candidates: LINES.map((line, i) => buildCandidate(brief, inventory, line, i)),
  };
}

function buildCandidate(brief: Brief, inventoryList: DetectedHold[], line: Line, index: number): Candidate {
  const rng = mulberry32(hashString(`${JSON.stringify(brief)}|${index}`));
  const g = gradeToNumber(brief.grade) ?? 4;
  const tier = tierFor(g);
  const W = brief.wallWidthM;
  const H = brief.wallHeightM;
  const move = brief.requiredMove;
  const heightScale = brief.climberHeightCm / 170;
  const reachFactor = notesReachFactor(brief.notes);
  const stepM = (0.42 + g * 0.05) * heightScale * STYLE_STEP[brief.style] * reachFactor;
  const limit = reachLimitMeters(brief.climberHeightCm) * reachFactor;
  const pctX = (m: number) => (m / W) * 100;
  const pctY = (m: number) => (m / H) * 100;
  const holdMap = new Map<string, DetectedHold>(inventoryList.map((h): [string, DetectedHold] => [h.id, h]));

  // --- Hand line ---
  const startY = clamp(100 - pctY(1.25 * heightScale) + (rng() - 0.5) * 4, 40, 85);
  const finishY = clamp(100 - pctY(H - 0.35) + (rng() - 0.5) * 3, 4, 22);
  const spanM = ((startY - finishY) / 100) * H;
  const moves = clamp(Math.round(spanM / stepM), 3, 6);
  const handCount = moves + 1;
  let footCount = g <= 1 ? 3 : g <= 4 ? 2 : 1;
  while (handCount + footCount > 9) footCount--;
  while (handCount + footCount < 5) footCount++;

  const zig = pctX(0.16 + rng() * 0.08) * (brief.style === "flowy" ? 1.25 : 1);
  const hands: HandSlot[] = [];
  for (let i = 0; i < handCount; i++) {
    const t = i / (handCount - 1);
    const middle = i > 0 && i < handCount - 1;
    const x = line.x(t) + (middle ? (i % 2 === 0 ? -zig : zig) + (rng() - 0.5) * 4 : (rng() - 0.5) * 3);
    const y = startY + (finishY - startY) * t + (middle ? (rng() - 0.5) * 4 : 0);
    hands.push({ x, y, holdId: null, role: i === 0 ? "start" : i === handCount - 1 ? "finish" : "hand" });
  }
  const crux = clamp(Math.round((handCount - 1) * 0.6), 1, handCount - 2);

  // --- Move-specific geometry ---
  if ((move === "dyno" || move === "deadpoint") && crux >= 2) {
    const pull = move === "dyno" ? 0.55 : 0.3;
    hands[crux - 1].y += (hands[crux - 2].y - hands[crux - 1].y) * pull;
  }
  let hookSide = 1;
  if (move === "heel hook" || move === "toe hook") {
    hookSide = hands[crux].x >= hands[crux - 1].x ? 1 : -1;
    hands[crux - 1].x += hookSide * pctX(0.3);
    hands[crux - 1].y += pctY(0.1);
  }
  if (move === "compression") {
    const mid = (hands[crux - 1].x + hands[crux].x) / 2;
    const half = pctX(0.42);
    hands[crux - 1].x = mid - half;
    hands[crux].x = mid + half;
    hands[crux].y = hands[crux - 1].y - pctY(0.1);
  }
  for (const h of hands) {
    h.x = clamp(h.x, 7, 93);
    h.y = clamp(h.y, 4, 90);
  }

  // Keep ordinary hand moves inside a comfortable reach; allow the dyno to be long.
  const comfort = limit * 0.88;
  for (let i = 1; i < hands.length; i++) {
    const cap = move === "dyno" && i === crux ? limit * 1.1 : comfort;
    const a = hands[i - 1];
    const b = hands[i];
    const dxM = ((b.x - a.x) / 100) * W;
    const dyM = ((b.y - a.y) / 100) * H;
    const d = Math.hypot(dxM, dyM);
    if (d <= cap) continue;
    if (Math.abs(dyM) < cap) {
      const maxDx = Math.sqrt(cap * cap - dyM * dyM);
      b.x = a.x + Math.sign(dxM) * pctX(maxDx);
    } else {
      const s = cap / d;
      b.x = a.x + (b.x - a.x) * s;
      b.y = a.y + (b.y - a.y) * s;
    }
  }

  // --- Feet ---
  const feet: FootSlot[] = [];
  const footDrop = pctY(0.95 * heightScale);
  for (let j = 0; j < footCount; j++) {
    const ref = hands[Math.min(j, hands.length - 2)];
    const side = j % 2 === 0 ? -1 : 1;
    feet.push({
      x: clamp(ref.x + side * pctX(0.22) + (rng() - 0.5) * 3, 6, 94),
      y: clamp(ref.y + footDrop, 8, 95),
      holdId: null,
      high: false,
    });
  }
  if (move === "high step") {
    const ref = hands[crux - 1];
    const f = feet[feet.length - 1];
    f.x = clamp(ref.x + pctX(0.15), 6, 94);
    f.y = clamp(ref.y + pctY(0.35), 8, 95);
    f.high = true;
  }

  // --- Hold assignment ---
  const inv = new Inventory(inventoryList);
  const handScore = (h: DetectedHold) => {
    if (h.apparentType === "foothold") return -10;
    const base = (GRADE_PREFS[tier][h.apparentType] ?? 0) + (STYLE_PREFS[brief.style][h.apparentType] ?? 0);
    const sizeW = tier === "easy" ? 0.5 : tier === "mid" ? 0.1 : -0.25;
    return base + SIZE_SCORE[h.relativeSize] * sizeW + rng() * 0.9;
  };

  const finish = hands[hands.length - 1];
  finish.holdId =
    inv.take(
      (h) =>
        (h.apparentType === "jug" ? 4 : 0) +
        SIZE_SCORE[h.relativeSize] +
        (move === "mantle" && h.apparentType === "sloper" ? 6 : 0) +
        (h.apparentType === "foothold" ? -10 : 0) +
        rng() * 0.3,
    )?.id ?? null;

  const featureIdx = featureIndexFor(move, crux);
  const prefs = MOVE_FEATURE[move];
  const featureScore = (h: DetectedHold) => {
    const k = prefs ? prefs.indexOf(h.apparentType) : -1;
    return (k < 0 ? -5 : 5 - k) + SIZE_SCORE[h.relativeSize] * 0.4 + rng() * 0.3;
  };
  if (featureIdx !== null && prefs) {
    hands[featureIdx].holdId = inv.take(featureScore)?.id ?? null;
    if (move === "compression") hands[crux - 1].holdId = inv.take(featureScore)?.id ?? null;
  }

  if (!hands[0].holdId) {
    hands[0].holdId =
      inv.take(
        (h) => handScore(h) + SIZE_SCORE[h.relativeSize] * 0.6 + (h.apparentType === "jug" && tier !== "hard" ? 1 : 0),
      )?.id ?? null;
  }
  for (const h of hands) if (!h.holdId) h.holdId = inv.take(handScore)?.id ?? null;
  for (const f of feet) {
    f.holdId =
      inv.take(
        (h) =>
          (h.apparentType === "foothold" ? 6 : 0) +
          (h.relativeSize === "small" ? 2 : 0) +
          (h.apparentType === "edge" || h.apparentType === "crimp" ? 1 : -1) -
          SIZE_SCORE[h.relativeSize] * 0.5 +
          rng() * 0.5,
      )?.id ?? null;
  }

  // --- Placements ---
  const typeOf = (id: string | null): HoldType => (id ? holdMap.get(id)?.apparentType ?? "unknown" : "unknown");
  const toPlacement = (slot: { x: number; y: number; holdId: string | null }, role: PlacementRole, t: number) => ({
    sequenceNumber: 0,
    holdId: slot.holdId as string,
    xPercent: round1(clamp(slot.x, 0, 100)),
    yPercent: round1(clamp(slot.y, 0, 100)),
    rotationDegrees: rotationFor(typeOf(slot.holdId), slot.x, line.x(t), rng),
    role,
  });

  const startP: Placement[] = hands[0].holdId ? [toPlacement(hands[0], "start", 0)] : [];
  const finishP: Placement[] = finish.holdId ? [toPlacement(finish, "finish", 1)] : [];
  const middle: Placement[] = [];
  hands.forEach((h, i) => {
    if (h.role === "hand" && h.holdId) middle.push(toPlacement(h, "hand", i / (handCount - 1)));
  });
  feet.forEach((f) => {
    if (f.holdId) middle.push(toPlacement(f, "foot", 0.5));
  });
  middle.sort((a, b) => b.yPercent - a.yPercent);
  const placements = [...startP, ...middle, ...finishP].map((p, i) => ({ ...p, sequenceNumber: i + 1 }));

  // Nudge markers that would overlap visually.
  for (let i = 1; i < placements.length; i++) {
    for (let k = 0; k < i; k++) {
      const a = placements[k];
      const b = placements[i];
      if (Math.hypot(a.xPercent - b.xPercent, a.yPercent - b.yPercent) < 4.5) {
        b.xPercent = round1(clamp(b.xPercent + (b.xPercent < 88 ? 6 : -6), 0, 100));
      }
    }
  }

  // --- Beta ---
  const describe = (id: string | null) => (id ? `${id} (${typeOf(id)})` : "the wall");
  const idOr = (id: string | null) => id ?? WALL_HOLD_ID;
  const steps: Array<Omit<BetaStep, "step">> = [];
  const footBeforeMove = new Map<number, FootSlot[]>();
  feet.forEach((f, j) => {
    if (j === 0 && !f.high) return;
    const moveIdx = f.high ? crux : Math.min(j + 1, handCount - 1);
    footBeforeMove.set(moveIdx, [...(footBeforeMove.get(moveIdx) ?? []), f]);
  });

  steps.push({
    limb: "both hands",
    holdId: idOr(hands[0].holdId),
    movement: "Start",
    explanation: `Match ${describe(hands[0].holdId)} to start; ${GRIP_HINT[typeOf(hands[0].holdId)]}.`,
  });
  const firstFoot = feet[0];
  const firstFootId = firstFoot && !firstFoot.high ? firstFoot.holdId : null;
  if (firstFootId) {
    steps.push({
      limb: "left foot",
      holdId: firstFootId,
      movement: "Set feet",
      explanation: `Left foot on ${describe(firstFootId)}; right foot smears on the wall or kicker.`,
    });
  }

  let lastHand: Limb | null = null;
  for (let i = 1; i < handCount; i++) {
    const slot = hands[i];
    const prev = hands[i - 1];
    const hand: Limb = slot.x >= prev.x ? "right hand" : "left hand";
    const oppositeFoot: Limb = hand === "right hand" ? "left foot" : "right foot";

    for (const f of footBeforeMove.get(i) ?? []) {
      steps.push({
        limb: oppositeFoot,
        holdId: idOr(f.holdId),
        movement: f.high ? "High step" : "Foot up",
        explanation: f.high
          ? `Rock over onto ${describe(f.holdId)} — the high step that unlocks the next reach.`
          : `Bring the ${oppositeFoot} up to ${describe(f.holdId)} to stay balanced for the next move.`,
      });
    }

    if (i === crux) {
      if (move === "heel hook" || move === "toe hook") {
        const isHeel = move === "heel hook";
        const side = hookSide > 0 ? "right" : "left";
        steps.push({
          limb: `${side} ${isHeel ? "heel" : "toe"}` as Limb,
          holdId: idOr(prev.holdId),
          movement: titleCase(move),
          explanation: isHeel
            ? `Set the ${side} heel on ${describe(prev.holdId)} and pull through the hamstring to keep the hips in on the ${brief.wallAngleDeg}° wall.`
            : `Hook the ${side} toe on ${describe(prev.holdId)} to stop the swing and hold body tension.`,
        });
      } else if (move === "flag") {
        steps.push({
          limb: oppositeFoot,
          holdId: WALL_HOLD_ID,
          movement: "Flag",
          explanation: `Flag the ${oppositeFoot} out on blank wall to counter-balance the reach.`,
        });
      } else if (move === "drop knee") {
        steps.push({
          limb: oppositeFoot,
          holdId: idOr(prev.holdId),
          movement: "Drop knee",
          explanation: `Turn the hip in and drop the knee using ${describe(prev.holdId)} as a foot.`,
        });
      }
    }

    let movement = hand === lastHand ? "Bump" : "Reach";
    let limb: Limb = hand;
    let explanation = `${titleCase(hand)} to ${describe(slot.holdId)}; ${GRIP_HINT[typeOf(slot.holdId)]}.`;
    if (i === crux) {
      if (move === "deadpoint") {
        movement = "Deadpoint";
        explanation = `Drive from the hips and catch ${describe(slot.holdId)} at the dead point.`;
      } else if (move === "dyno") {
        movement = "Dyno";
        limb = "body";
        explanation = `Coil low and jump for ${describe(slot.holdId)}; both hands leave the wall.`;
      } else if (move === "gaston") {
        movement = "Gaston";
        explanation = `${titleCase(hand)} gastons ${describe(slot.holdId)}, elbow out, pushing away from the body.`;
      } else if (move === "compression") {
        movement = "Compression";
        explanation = `Squeeze ${describe(prev.holdId)} and ${describe(slot.holdId)} against each other and walk the feet up.`;
      } else if (move === "none") {
        movement = { technical: "Precise reach", powerful: "Lock-off", dynamic: "Deadpoint", balancy: "Rockover", flowy: "Reach" }[
          brief.style
        ];
      }
    }
    if (i === handCount - 1 && move === "mantle") {
      movement = "Mantle";
      limb = "both hands";
      explanation = `Press out the mantle on ${describe(slot.holdId)} and get a foot up beside the hands.`;
    }
    steps.push({ limb, holdId: idOr(slot.holdId), movement, explanation });
    lastHand = limb === "body" ? null : hand;
  }
  if (move !== "mantle") {
    steps.push({
      limb: "both hands",
      holdId: idOr(finish.holdId),
      movement: "Match finish",
      explanation: `Match ${describe(finish.holdId)} and hold it in control.`,
    });
  }
  const beta: BetaStep[] = steps.map((s, i) => ({ ...s, step: i + 1 }));

  // --- Narrative ---
  const cruxSlot = hands[crux];
  const cruxHeight = ((100 - cruxSlot.y) / 100) * H;
  const moveLabel = move === "none" ? `${brief.style} crux` : move;
  const cruxText =
    featureIdx !== null && featureIdx !== crux
      ? `${titleCase(moveLabel)} on ${describe(hands[featureIdx].holdId)} to reach ${describe(cruxSlot.holdId)}, about ${cruxHeight.toFixed(1)} m off the floor.`
      : `${titleCase(moveLabel)} to ${describe(cruxSlot.holdId)} at move ${crux}, about ${cruxHeight.toFixed(1)} m off the floor.`;

  const usedTypes = Array.from(new Set(hands.map((h) => typeOf(h.holdId)).filter((t) => t !== "unknown")));
  const avgMove = spanM / moves;
  const rationale =
    `${titleCase(brief.style)} ${brief.grade} concept on a ${brief.wallAngleDeg}° wall following a ${line.name.toLowerCase()}. ` +
    `${moves} hand moves averaging ~${avgMove.toFixed(2)} m vertically for a ${brief.climberHeightCm} cm climber` +
    `${reachFactor !== 1 ? ` (adjusted by setter notes)` : ""}. ` +
    `Hand holds lean on ${usedTypes.join(", ")} as a ${tier}-grade proxy; ${footCount} dedicated foot chip(s).`;

  const warnings = ["Sample engine: placements are illustrative and are not derived from image analysis."];
  if (brief.wallAngleDeg < 0 && move === "heel hook") warnings.push("Heel hooks are less natural on slab; forerun to check it is used.");
  if (brief.wallAngleDeg >= 35 && g <= 1) warnings.push("Steep wall for this grade — consider only jugs and large footholds.");
  if (move === "dyno") warnings.push("Dynamic move: check the fall zone, swing direction and spotting space.");
  if (cruxHeight > 2.5) warnings.push("Crux is high on the wall; check the landing and fall trajectory.");

  const [lo, hi] = GRADE_RANGE_OFFSETS[index % GRADE_RANGE_OFFSETS.length];
  return {
    name: `${line.name} — ${titleCase(moveLabel)}`,
    targetGrade: brief.grade,
    estimatedGradeLow: `V${clamp(g + lo, 0, 17)}`,
    estimatedGradeHigh: `V${clamp(g + hi, 0, 17)}`,
    confidence: Math.round((0.38 + rng() * 0.15) * 100) / 100,
    style: brief.style,
    placements,
    beta,
    crux: cruxText,
    rationale,
    warnings,
  };
}
