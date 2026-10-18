import { NextResponse } from "next/server";
import { aiAvailable, configuredModel, generatePhotoRoutesWithOpenAI, generateVirtualWithOpenAI } from "../../../lib/openai";
import { generateSampleRoutes, SAMPLE_HOLDS } from "../../../lib/sampleGenerator";
import { GenerateRequestSchema, type GenerateResponse, type RouteResponse } from "../../../lib/schema";
import { validateRouteResponse } from "../../../lib/validator";
import { PhotoWorkflowError, isValidWallBoundary, photoFailurePayload, type PhotoFailureCategory } from "../../../lib/photoWorkflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Lets the UI show whether AI mode is configured. Never returns the key. */
export async function GET() {
  return NextResponse.json({ aiAvailable: aiAvailable(), model: aiAvailable() ? configuredModel() : null });
}

export async function POST(req: Request) {
  const photoFail = (category: PhotoFailureCategory, status: number) => {
    console.error(`[setbeta] photo generation failed: ${category}`);
    return NextResponse.json(photoFailurePayload(category), { status });
  };
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    if (typeof body === "object" && body !== null && "workflow" in body && body.workflow === "photo") {
      const imageIssue = parsed.error.issues.some((issue) => issue.path[0] === "wallImage" || issue.path[0] === "holdsImage");
      return photoFail(imageIssue ? "image_processing" : "route_validation", 400);
    }
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");
    return NextResponse.json({ error: `Invalid request — ${message}` }, { status: 400 });
  }

  const { brief, workflow, inventory, wallImage, wallBoundary, forceSample } = parsed.data;
  if (workflow === "photo") {
    if (forceSample) {
      const validated = validateRouteResponse(generateSampleRoutes(brief), brief);
      return NextResponse.json({ mode: "sample", model: null, detectedHolds: validated.detectedHolds,
        candidates: validated.candidates, notices: ["Sample concepts were requested explicitly. They use the sample wall and holds, not your photos."] });
    }
    if (!wallImage) return photoFail("image_processing", 400);
    if (!inventory || new Set(inventory.map((h) => h.id)).size !== inventory.length ||
        !wallBoundary || !isValidWallBoundary(wallBoundary)) return photoFail("route_validation", 400);
    if (!aiAvailable()) return photoFail("api_request", 503);
    try {
      const raw = await generatePhotoRoutesWithOpenAI(brief, wallImage, inventory, wallBoundary);
      const validated = validateRouteResponse(raw, brief);
      if (validated.candidates.length !== 3 || validated.candidates.some((c) => c.validation.status === "invalid")) {
        return photoFail("route_validation", 422);
      }
      return NextResponse.json({ mode: "ai", model: configuredModel(), detectedHolds: inventory,
        candidates: validated.candidates, notices: validated.notices } satisfies GenerateResponse);
    } catch (error) {
      return photoFail(error instanceof PhotoWorkflowError ? error.category : "route_validation", 502);
    }
  }
  if (workflow === "virtual" && inventory && new Set(inventory.map((h) => h.id)).size !== inventory.length) {
    return NextResponse.json({ error: "Inventory hold IDs must be unique." }, { status: 400 });
  }
  const notices: string[] = [];
  let raw: RouteResponse | null = null;
  let mode: GenerateResponse["mode"] = "sample";

  if (forceSample) {
    notices.push("Sample mode forced — no AI call was made.");
  } else if (!aiAvailable()) {
    notices.push("No OPENAI_API_KEY configured — using the deterministic sample engine.");
  } else {
    try {
      raw = await generateVirtualWithOpenAI(brief, inventory ?? SAMPLE_HOLDS);
      mode = "ai";
    } catch (err) {
      // Keep external API errors out of responses and logs; they may contain request details.
      console.error("[setbeta] AI generation failed; using sample fallback.");
      notices.push("AI generation failed. Showing deterministic sample concepts instead.");
    }
  }

  if (!raw) raw = generateSampleRoutes(brief);

  let validated = validateRouteResponse(raw, brief);
  if (mode === "ai" && (validated.candidates.length !== 3 || validated.candidates.some((c) => c.validation.status === "invalid"))) {
    notices.push("AI returned incomplete route concepts. Showing deterministic sample concepts instead.");
    mode = "sample";
    validated = validateRouteResponse(generateSampleRoutes(brief), brief);
  }
  if (mode === "ai") {
    notices.unshift("AI generated wall placements and beta from virtual dimensions and structured sample holds; grade estimates require human review.");
  }
  const payload: GenerateResponse = {
    mode,
    model: mode === "ai" ? configuredModel() : null,
    detectedHolds: validated.detectedHolds,
    candidates: validated.candidates,
    notices: [...notices, ...validated.notices],
  };
  return NextResponse.json(payload);
}
