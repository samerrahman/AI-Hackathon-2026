// Server-side only: imported exclusively by app/api/generate/route.ts.
import OpenAI from "openai";
import { INVENTORY_JSON_SCHEMA, PHOTO_ROUTE_JSON_SCHEMA, ROUTE_JSON_SCHEMA } from "./jsonSchema";
import { INVENTORY_SYSTEM_PROMPT, PHOTO_ROUTE_SYSTEM_PROMPT, VIRTUAL_SYSTEM_PROMPT, buildPhotoRouteUserPrompt, buildVirtualUserPrompt } from "./prompt";
import { CandidateSchema, RouteResponseSchema, type Brief, type Candidate, type DetectedHold, type RouteResponse, type WallBoundary } from "./schema";
import { InventoryAnalysisSchema, PhotoWorkflowError, normalizeDetectedInventory } from "./photoWorkflow";

export const DEFAULT_MODEL = "gpt-4.1";

export function configuredModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

export function aiAvailable(): boolean {
  const key = process.env.OPENAI_API_KEY?.trim();
  return Boolean(key && key !== "your_project_key_here" && !key.includes("...your project key..."));
}

function parsePhotoOutput(text: string | undefined): unknown {
  if (!text) throw new PhotoWorkflowError("response_schema");
  try { return JSON.parse(text); }
  catch { throw new PhotoWorkflowError("response_schema"); }
}

export async function analyzeHoldsWithOpenAI(holdsImage: string): Promise<DetectedHold[]> {
  let response;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90_000, maxRetries: 1 });
    response = await client.responses.create({
      model: configuredModel(), instructions: INVENTORY_SYSTEM_PROMPT,
      input: [{ role: "user", content: [
        { type: "input_text", text: "Identify the loose climbing holds in this photo. Return only the numbered inventory." },
        { type: "input_image", image_url: holdsImage, detail: "high" },
      ] }],
      text: { format: { type: "json_schema", name: "setbeta_hold_inventory", schema: INVENTORY_JSON_SCHEMA, strict: true } },
    });
  } catch { throw new PhotoWorkflowError("api_request"); }
  const parsed = InventoryAnalysisSchema.safeParse(parsePhotoOutput(response.output_text));
  if (!parsed.success) throw new PhotoWorkflowError("response_schema");
  return normalizeDetectedInventory(parsed.data.detectedHolds);
}

export async function generatePhotoRoutesWithOpenAI(
  brief: Brief, wallImage: string, inventory: DetectedHold[], boundary: WallBoundary,
): Promise<RouteResponse> {
  let response;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90_000, maxRetries: 1 });
    response = await client.responses.create({
      model: configuredModel(), instructions: PHOTO_ROUTE_SYSTEM_PROMPT,
      input: [{ role: "user", content: [
        { type: "input_text", text: buildPhotoRouteUserPrompt(brief, inventory, boundary) },
        { type: "input_image", image_url: wallImage, detail: "high" },
      ] }],
      text: { format: { type: "json_schema", name: "setbeta_photo_routes", schema: PHOTO_ROUTE_JSON_SCHEMA, strict: true } },
    });
  } catch { throw new PhotoWorkflowError("api_request"); }
  const value = parsePhotoOutput(response.output_text);
  const parsed = CandidateSchema.array().safeParse((value as { candidates?: unknown } | null)?.candidates);
  if (!parsed.success) throw new PhotoWorkflowError("response_schema");
  return { detectedHolds: inventory, candidates: parsed.data as Candidate[] };
}

/** Text-only path for the virtual wall. The inventory is supplied by the setter. */
export async function generateVirtualWithOpenAI(
  brief: Brief,
  inventory: DetectedHold[],
): Promise<RouteResponse> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90_000, maxRetries: 1 });
  const response = await client.responses.create({
    model: configuredModel(),
    instructions: VIRTUAL_SYSTEM_PROMPT,
    input: [{ role: "user", content: [{ type: "input_text", text: buildVirtualUserPrompt(brief, inventory) }] }],
    text: { format: { type: "json_schema", name: "setbeta_virtual_routes", schema: ROUTE_JSON_SCHEMA, strict: true } },
  });
  if (!response.output_text) throw new Error("The model returned no structured output (it may have refused).");
  let json: unknown;
  try { json = JSON.parse(response.output_text); }
  catch { throw new Error("The model returned output that was not valid JSON."); }
  const parsed = RouteResponseSchema.safeParse(json);
  if (!parsed.success) throw new Error(`Model output did not match the schema: ${parsed.error.issues[0]?.message ?? "unknown issue"}`);
  // The model cannot add or relabel physical holds. Only the supplied inventory is authoritative.
  return { ...parsed.data, detectedHolds: inventory };
}
