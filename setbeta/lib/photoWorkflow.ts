import { z } from "zod";
import { HOLD_SIZES, HOLD_TYPES, PointSchema, type DetectedHold, type Point, type WallBoundary } from "./schema";

export const InventoryAnalysisSchema = z.object({
  detectedHolds: z.array(z.object({
    id: z.string(),
    apparentType: z.enum(HOLD_TYPES),
    relativeSize: z.enum(HOLD_SIZES),
    confidence: z.number().finite(),
    xPercent: z.number().finite(),
    yPercent: z.number().finite(),
  })).min(1).max(100),
});

export const PHOTO_FAILURE_CATEGORIES = ["image_processing", "api_request", "response_schema", "route_validation"] as const;
export type PhotoFailureCategory = (typeof PHOTO_FAILURE_CATEGORIES)[number];

export class PhotoWorkflowError extends Error {
  constructor(public readonly category: PhotoFailureCategory) {
    super(category);
    this.name = "PhotoWorkflowError";
  }
}

const MESSAGES: Record<PhotoFailureCategory, string> = {
  image_processing: "The photo could not be processed. Try a smaller JPEG or PNG image.",
  api_request: "The AI request could not be completed. Check the configured key, model, and connection, then retry.",
  response_schema: "The AI response did not contain the expected hold or route data. Please retry.",
  route_validation: "The proposed routes did not pass the route checks. Please retry or review sample concepts.",
};

export function photoFailurePayload(category: PhotoFailureCategory, development = process.env.NODE_ENV !== "production") {
  return { error: MESSAGES[category], ...(development ? { category } : {}) };
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

export function normalizeDetectedInventory(holds: DetectedHold[]): DetectedHold[] {
  return holds.map((hold, index) => ({
    ...hold,
    id: `H${index + 1}`,
    confidence: Math.min(1, Math.max(0, hold.confidence)),
    xPercent: round1(clamp(hold.xPercent)),
    yPercent: round1(clamp(hold.yPercent)),
  }));
}

export function nextHoldId(holds: readonly DetectedHold[]): string {
  const ids = new Set(holds.map((h) => h.id));
  let number = 1;
  while (ids.has(`H${number}`)) number += 1;
  return `H${number}`;
}

export function addHold(holds: readonly DetectedHold[], point: Point): DetectedHold[] {
  return [...holds, {
    id: nextHoldId(holds), apparentType: "unknown", relativeSize: "medium", confidence: 1,
    xPercent: round1(clamp(point.xPercent)), yPercent: round1(clamp(point.yPercent)),
  }];
}

export function updateHold(holds: readonly DetectedHold[], id: string, changes: Partial<Omit<DetectedHold, "id">>): DetectedHold[] {
  return holds.map((hold) => hold.id === id ? {
    ...hold, ...changes,
    xPercent: round1(clamp(changes.xPercent ?? hold.xPercent)),
    yPercent: round1(clamp(changes.yPercent ?? hold.yPercent)),
  } : hold);
}

export function removeHold(holds: readonly DetectedHold[], id: string): DetectedHold[] {
  return holds.filter((hold) => hold.id !== id);
}

export function isValidWallBoundary(boundary: readonly Point[]): boundary is WallBoundary {
  if (boundary.length !== 4 || !boundary.every((point) => PointSchema.safeParse(point).success)) return false;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.xPercent - a.xPercent) * (c.yPercent - b.yPercent) -
    (b.yPercent - a.yPercent) * (c.xPercent - b.xPercent);
  const turns = boundary.map((point, index) => cross(point, boundary[(index + 1) % 4], boundary[(index + 2) % 4]));
  const area = Math.abs(boundary.reduce((sum, point, index) => {
    const next = boundary[(index + 1) % 4];
    return sum + point.xPercent * next.yPercent - next.xPercent * point.yPercent;
  }, 0)) / 2;
  return area >= 100 && turns.every((turn) => turn > 0);
}

/** Map a route coordinate on the rectangular wall to its displayed photo quadrilateral. */
export function mapWallPoint(point: Point, boundary: WallBoundary): Point {
  const u = point.xPercent / 100;
  const v = point.yPercent / 100;
  const [topLeft, topRight, bottomRight, bottomLeft] = boundary;
  const blend = (key: keyof Point) =>
    (1 - v) * ((1 - u) * topLeft[key] + u * topRight[key]) +
    v * ((1 - u) * bottomLeft[key] + u * bottomRight[key]);
  return { xPercent: blend("xPercent"), yPercent: blend("yPercent") };
}
