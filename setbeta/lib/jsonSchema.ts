import { HOLD_SIZES, HOLD_TYPES, LIMBS, PLACEMENT_ROLES } from "./schema";

/**
 * Strict JSON schema for OpenAI Structured Outputs.
 * Mirrors RouteResponseSchema in schema.ts. Strict mode requires every property
 * to be listed in `required` and `additionalProperties: false` on every object.
 * Numeric ranges and the "exactly three" rule are enforced by the prompt and the
 * deterministic validator rather than the schema, to stay within strict-mode support.
 */
export const ROUTE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["detectedHolds", "candidates"],
  properties: {
    detectedHolds: {
      type: "array",
      description: "Every distinct hold visible in the inventory photo (image 2), IDs H1, H2, ... in reading order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "apparentType", "relativeSize", "confidence", "xPercent", "yPercent"],
        properties: {
          id: { type: "string", description: "H1, H2, ..." },
          apparentType: { type: "string", enum: [...HOLD_TYPES] },
          relativeSize: { type: "string", enum: [...HOLD_SIZES] },
          confidence: { type: "number", description: "0 to 1" },
          xPercent: { type: "number", description: "Center of this hold in inventory photo, 0 left to 100 right" },
          yPercent: { type: "number", description: "Center of this hold in inventory photo, 0 top to 100 bottom" },
        },
      },
    },
    candidates: {
      type: "array",
      description: "Exactly three materially different route concepts.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "targetGrade",
          "estimatedGradeLow",
          "estimatedGradeHigh",
          "confidence",
          "style",
          "placements",
          "beta",
          "crux",
          "rationale",
          "warnings",
        ],
        properties: {
          name: { type: "string" },
          targetGrade: { type: "string", description: "e.g. V4" },
          estimatedGradeLow: { type: "string", description: "e.g. V3" },
          estimatedGradeHigh: { type: "string", description: "e.g. V5" },
          confidence: { type: "number", description: "0 to 1: how confident you are the concept climbs as described" },
          style: { type: "string" },
          placements: {
            type: "array",
            description: "5 to 9 placements in climbing order.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sequenceNumber", "holdId", "xPercent", "yPercent", "rotationDegrees", "role"],
              properties: {
                sequenceNumber: { type: "integer", description: "1-based climbing order" },
                holdId: { type: "string", description: "An id from detectedHolds" },
                xPercent: { type: "number", description: "0 (left edge of wall photo) to 100 (right edge)" },
                yPercent: { type: "number", description: "0 (top of wall photo) to 100 (bottom)" },
                rotationDegrees: {
                  type: "number",
                  description: "Clockwise rotation of the usable edge from 'incut facing up' (0). 90 = edge faces right, 180 = undercling, 270 = edge faces left.",
                },
                role: { type: "string", enum: [...PLACEMENT_ROLES] },
              },
            },
          },
          beta: {
            type: "array",
            description: "Intended movement sequence.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["step", "limb", "holdId", "movement", "explanation"],
              properties: {
                step: { type: "integer" },
                limb: { type: "string", enum: [...LIMBS] },
                holdId: { type: "string", description: "A holdId used in this route's placements, or WALL for smears/flags" },
                movement: { type: "string", description: "Short move name, e.g. Heel hook, Deadpoint, Reach" },
                explanation: { type: "string" },
              },
            },
          },
          crux: { type: "string" },
          rationale: { type: "string" },
          warnings: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const routeProperties = ROUTE_JSON_SCHEMA.properties as Record<string, unknown>;

export const INVENTORY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["detectedHolds"],
  properties: { detectedHolds: routeProperties.detectedHolds },
};

const photoCandidates = structuredClone(routeProperties.candidates) as {
  items: { properties: { placements: { items: { properties: Record<string, { description?: string }> } } } };
};
photoCandidates.items.properties.placements.items.properties.holdId.description = "An ID from the confirmed physical hold inventory";
photoCandidates.items.properties.placements.items.properties.xPercent.description = "Wall-local 0 to 100, from selected left edge to selected right edge";
photoCandidates.items.properties.placements.items.properties.yPercent.description = "Wall-local 0 to 100, from selected top edge to selected bottom edge";

export const PHOTO_ROUTE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["candidates"],
  properties: { candidates: photoCandidates },
};
