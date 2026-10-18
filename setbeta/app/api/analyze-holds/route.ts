import { NextResponse } from "next/server";
import { aiAvailable, analyzeHoldsWithOpenAI, configuredModel } from "../../../lib/openai";
import { PhotoWorkflowError, photoFailurePayload } from "../../../lib/photoWorkflow";
import { AnalyzeHoldsRequestSchema } from "../../../lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function fail(category: PhotoWorkflowError["category"], status: number) {
  // The category is fixed vocabulary. Never log the key, the request body, or API errors.
  console.error(`[setbeta] photo inventory failed: ${category}`);
  return NextResponse.json(photoFailurePayload(category), { status });
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return fail("image_processing", 400); }
  const parsed = AnalyzeHoldsRequestSchema.safeParse(body);
  if (!parsed.success) return fail("image_processing", 400);
  if (!aiAvailable()) return fail("api_request", 503);
  try {
    const detectedHolds = await analyzeHoldsWithOpenAI(parsed.data.holdsImage!);
    return NextResponse.json({ detectedHolds, model: configuredModel() });
  } catch (error) {
    const category = error instanceof PhotoWorkflowError ? error.category : "api_request";
    return fail(category, 502);
  }
}
