import { z } from "zod";

// ---------- Vocabularies ----------

export const GRADES = ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7"] as const;
export const STYLES = ["technical", "powerful", "dynamic", "balancy", "flowy"] as const;
export const REQUIRED_MOVES = [
  "none",
  "heel hook",
  "toe hook",
  "flag",
  "high step",
  "drop knee",
  "deadpoint",
  "dyno",
  "compression",
  "mantle",
  "gaston",
] as const;

export const HOLD_TYPES = [
  "jug",
  "crimp",
  "edge",
  "pinch",
  "sloper",
  "sidepull",
  "undercling",
  "pocket",
  "foothold",
  "volume",
  "unknown",
] as const;
export const HOLD_SIZES = ["small", "medium", "large", "extra-large"] as const;
export const PLACEMENT_ROLES = ["start", "hand", "foot", "finish"] as const;
export const LIMBS = [
  "left hand",
  "right hand",
  "both hands",
  "left foot",
  "right foot",
  "left heel",
  "right heel",
  "left toe",
  "right toe",
  "body",
] as const;

/** Special holdId for beta steps that use blank wall (smears, flags). */
export const WALL_HOLD_ID = "WALL";

export type Grade = (typeof GRADES)[number];
export type Style = (typeof STYLES)[number];
export type RequiredMove = (typeof REQUIRED_MOVES)[number];
export type HoldType = (typeof HOLD_TYPES)[number];
export type HoldSize = (typeof HOLD_SIZES)[number];
export type PlacementRole = (typeof PLACEMENT_ROLES)[number];
export type Limb = (typeof LIMBS)[number];

// ---------- AI response schema ----------

export const DetectedHoldSchema = z.object({
  id: z.string().min(1),
  apparentType: z.enum(HOLD_TYPES),
  relativeSize: z.enum(HOLD_SIZES),
  confidence: z.number(),
  xPercent: z.number(),
  yPercent: z.number(),
});

export const PlacementSchema = z.object({
  sequenceNumber: z.number(),
  holdId: z.string(),
  xPercent: z.number(),
  yPercent: z.number(),
  rotationDegrees: z.number(),
  role: z.enum(PLACEMENT_ROLES),
});

export const BetaStepSchema = z.object({
  step: z.number(),
  limb: z.enum(LIMBS),
  holdId: z.string(),
  movement: z.string(),
  explanation: z.string(),
});

export const CandidateSchema = z.object({
  name: z.string(),
  targetGrade: z.string(),
  estimatedGradeLow: z.string(),
  estimatedGradeHigh: z.string(),
  confidence: z.number(),
  style: z.string(),
  placements: z.array(PlacementSchema),
  beta: z.array(BetaStepSchema),
  crux: z.string(),
  rationale: z.string(),
  warnings: z.array(z.string()),
});

export const RouteResponseSchema = z.object({
  detectedHolds: z.array(DetectedHoldSchema),
  candidates: z.array(CandidateSchema),
});

export type DetectedHold = z.infer<typeof DetectedHoldSchema>;
export type Placement = z.infer<typeof PlacementSchema>;
export type BetaStep = z.infer<typeof BetaStepSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type RouteResponse = z.infer<typeof RouteResponseSchema>;

export const PointSchema = z.object({
  xPercent: z.number().finite().min(0).max(100),
  yPercent: z.number().finite().min(0).max(100),
});
export type Point = z.infer<typeof PointSchema>;
/** Top-left, top-right, bottom-right, bottom-left in photo coordinates. */
export const WallBoundarySchema = z.tuple([PointSchema, PointSchema, PointSchema, PointSchema]);
export type WallBoundary = z.infer<typeof WallBoundarySchema>;

// ---------- Request schema ----------

export const BriefSchema = z.object({
  wallWidthM: z.number().min(1).max(20),
  wallHeightM: z.number().min(1).max(10),
  wallAngleDeg: z.number().min(-30).max(70),
  grade: z.enum(GRADES),
  style: z.enum(STYLES),
  requiredMove: z.enum(REQUIRED_MOVES),
  climberHeightCm: z.number().min(100).max(230),
  notes: z.string().max(500),
});
export type Brief = z.infer<typeof BriefSchema>;

export const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export const ImageField = z
  .string()
  .max(15_000_000, "Image is too large; please use a smaller photo.")
  .regex(DATA_URL_RE, "Images must be PNG, JPEG, WebP or GIF data URLs.")
  .nullable()
  .optional();

export const GenerateRequestSchema = z.object({
  brief: BriefSchema,
  workflow: z.enum(["virtual", "photo"]).default("virtual"),
  inventory: z.array(DetectedHoldSchema).min(5).max(100).optional(),
  wallBoundary: WallBoundarySchema.optional(),
  wallImage: ImageField,
  holdsImage: ImageField,
  forceSample: z.boolean().optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const AnalyzeHoldsRequestSchema = z.object({ holdsImage: ImageField.refine((value) => Boolean(value)) });

// ---------- Validated output ----------

export type ValidationStatus = "ok" | "repaired" | "invalid";

export interface ValidatedCandidate extends Candidate {
  validation: { status: ValidationStatus; notes: string[] };
}

export interface GenerateResponse {
  mode: "ai" | "sample";
  model: string | null;
  detectedHolds: DetectedHold[];
  candidates: ValidatedCandidate[];
  notices: string[];
}

// ---------- Helpers ----------

export function gradeToNumber(grade: string): number | null {
  const m = /^V(\d{1,2})$/i.exec(grade.trim());
  return m ? Number(m[1]) : null;
}
