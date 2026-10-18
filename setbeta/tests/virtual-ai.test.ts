import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateSampleRoutes, SAMPLE_HOLDS } from "../lib/sampleGenerator";
import type { Brief } from "../lib/schema";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({ default: class { responses = { create }; } }));

const brief: Brief = {
  wallWidthM: 3.5, wallHeightM: 4, wallAngleDeg: 20, grade: "V4",
  style: "technical", requiredMove: "heel hook", climberHeightCm: 170, notes: "",
};
const originalKey = process.env.OPENAI_API_KEY;
beforeAll(() => { process.env.OPENAI_API_KEY = "test-only-key"; });
afterAll(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

describe("virtual wall API", () => {
  it("sends dimensions and structured holds as text, then validates three AI concepts", async () => {
    create.mockResolvedValueOnce({ output_text: JSON.stringify(generateSampleRoutes(brief)) });
    const { POST } = await import("../app/api/generate/route");
    const response = await POST(new Request("http://localhost/api/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, workflow: "virtual", inventory: SAMPLE_HOLDS }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.mode).toBe("ai");
    expect(body.candidates).toHaveLength(3);
    expect(body.candidates.every((c: { validation: { status: string } }) => c.validation.status !== "invalid")).toBe(true);
    const request = create.mock.calls.at(-1)?.[0];
    const text = request.input[0].content[0].text;
    expect(text).toContain("3.5 m wide × 4 m high");
    expect(text).toContain('"id":"H15"');
    expect(request.input[0].content.every((part: { type: string }) => part.type === "input_text")).toBe(true);
  });

  it("falls back to the sample engine when the AI call fails", async () => {
    create.mockRejectedValueOnce(new Error("test failure"));
    const { POST } = await import("../app/api/generate/route");
    const response = await POST(new Request("http://localhost/api/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, workflow: "virtual", inventory: SAMPLE_HOLDS }),
    }));
    const body = await response.json();
    expect(body.mode).toBe("sample");
    expect(body.candidates).toHaveLength(3);
    expect(body.notices.join(" ")).toMatch(/sample concepts/i);
  });

  it("falls back when AI returns fewer than three concepts", async () => {
    const incomplete = generateSampleRoutes(brief);
    incomplete.candidates = incomplete.candidates.slice(0, 2);
    create.mockResolvedValueOnce({ output_text: JSON.stringify(incomplete) });
    const { POST } = await import("../app/api/generate/route");
    const response = await POST(new Request("http://localhost/api/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, workflow: "virtual", inventory: SAMPLE_HOLDS }),
    }));
    const body = await response.json();
    expect(body.mode).toBe("sample");
    expect(body.candidates).toHaveLength(3);
  });
});
