import { describe, expect, it } from "vitest";
import { addHold, isValidWallBoundary, mapWallPoint, normalizeDetectedInventory, photoFailurePayload, removeHold, updateHold } from "../lib/photoWorkflow";
import type { DetectedHold, WallBoundary } from "../lib/schema";

const boundary: WallBoundary = [
  { xPercent: 10, yPercent: 10 }, { xPercent: 90, yPercent: 20 },
  { xPercent: 80, yPercent: 90 }, { xPercent: 20, yPercent: 80 },
];

describe("photo inventory editing", () => {
  it("normalizes labels and photo centers, then adds, corrects and removes a hold", () => {
    const detected: DetectedHold[] = [{ id: "other", apparentType: "jug", relativeSize: "large", confidence: 0.7, xPercent: 101, yPercent: -1 }];
    const normalized = normalizeDetectedInventory(detected);
    expect(normalized).toEqual([{ ...detected[0], id: "H1", xPercent: 100, yPercent: 0 }]);
    const added = addHold(normalized, { xPercent: 33.33, yPercent: 44.44 });
    expect(added[1]).toMatchObject({ id: "H2", xPercent: 33.3, yPercent: 44.4, apparentType: "unknown" });
    const corrected = updateHold(added, "H2", { apparentType: "crimp", xPercent: 35 });
    expect(corrected[1]).toMatchObject({ id: "H2", apparentType: "crimp", xPercent: 35 });
    expect(added[1].apparentType).toBe("unknown");
    expect(removeHold(corrected, "H1").map((hold) => hold.id)).toEqual(["H2"]);
  });
});

describe("wall boundary mapping", () => {
  it("maps wall-local corners and center into a slanted photo boundary", () => {
    expect(isValidWallBoundary(boundary)).toBe(true);
    expect(mapWallPoint({ xPercent: 0, yPercent: 0 }, boundary)).toEqual(boundary[0]);
    expect(mapWallPoint({ xPercent: 100, yPercent: 100 }, boundary)).toEqual(boundary[2]);
    expect(mapWallPoint({ xPercent: 50, yPercent: 50 }, boundary)).toEqual({ xPercent: 50, yPercent: 50 });
  });
  it("rejects crossed corners", () => {
    expect(isValidWallBoundary([boundary[0], boundary[2], boundary[1], boundary[3]])).toBe(false);
  });
});

describe("safe photo failure reporting", () => {
  it("returns only a fixed message and category in development", () => {
    const payload = photoFailurePayload("api_request", true);
    expect(payload).toEqual({ category: "api_request", error: expect.any(String) });
    expect(JSON.stringify(payload)).not.toMatch(/data:image|sk-test-secret/);
    expect(photoFailurePayload("api_request", false)).not.toHaveProperty("category");
  });
});
