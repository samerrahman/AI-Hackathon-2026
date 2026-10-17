import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { STUDENT_NAME, prepareSystem, teachSystem, reviewSystem } from "./prompts.js";
import { mockPrepare, mockChat } from "./mock.js";

const MODEL = "claude-opus-5-5";
const MOCK = process.env.MOCK === "1";
const client = MOCK ? null : new Anthropic();

const ConceptsSchema = z.object({
  concepts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      mustExplain: z.string(),
    })
  ),
});

const TeachTurnSchema = z.object({
  reply: z.string(),
  newlyUnderstood: z.array(z.string()),
});

// One structured call. Server-side fallbacks cover the rare safety decline.
async function ask({ system, messages, schema, effort }) {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages,
  });
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to respond to that message.");
  }
  if (!response.parsed_output) throw new Error("Model returned unparseable output.");
  return response.parsed_output;
}

const toApiMessages = (messages) =>
  messages.map((m) => ({ role: m.role, content: m.content }));

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, mock: MOCK, student: STUDENT_NAME }));

// Turn pasted course notes into a checklist of concepts the user must teach.
app.post("/api/topics/prepare", async (req, res, next) => {
  try {
    const { title, notes } = req.body;
    if (!title?.trim() || !notes?.trim()) {
      return res.status(400).json({ error: "Title and notes are required." });
    }
    if (MOCK) return res.json(mockPrepare(title));
    const out = await ask({
      system: prepareSystem,
      messages: [{ role: "user", content: `Topic: ${title}\n\nCourse notes:\n${notes}` }],
      schema: ConceptsSchema,
      effort: "medium",
    });
    const concepts = out.concepts.map((c, i) => ({ ...c, id: `c${i + 1}` }));
    res.json({ concepts });
  } catch (err) {
    next(err);
  }
});

// mode "teach": the student is clueless and tracks what it has learned.
// mode "review": topic is complete; the student explains it back to help you re-learn.
app.post("/api/chat", async (req, res, next) => {
  try {
    const { topic, messages, mode } = req.body;
    if (!topic || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "topic and messages are required." });
    }
    if (MOCK) return res.json(mockChat(topic, messages, mode));

    if (mode === "review") {
      const out = await ask({
        system: reviewSystem(topic),
        messages: toApiMessages(messages),
        schema: z.object({ reply: z.string() }),
        effort: "low",
      });
      return res.json({ reply: out.reply, newlyUnderstood: [] });
    }

    const out = await ask({
      system: teachSystem(topic),
      messages: toApiMessages(messages),
      schema: TeachTurnSchema,
      effort: "low",
    });
    const valid = new Set(topic.concepts.map((c) => c.id));
    const already = new Set(topic.understood);
    res.json({
      reply: out.reply,
      newlyUnderstood: out.newlyUnderstood.filter((id) => valid.has(id) && !already.has(id)),
    });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  let message = err.message || "Something went wrong.";
  if (err instanceof Anthropic.AuthenticationError) {
    message = "No valid Anthropic API key. Add ANTHROPIC_API_KEY to .env, or set MOCK=1.";
  } else if (err instanceof Anthropic.RateLimitError) {
    message = "Rate limited by the Anthropic API. Try again in a moment.";
  }
  res.status(err.status && err.status < 600 ? err.status : 500).json({ error: message });
});

const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => console.log(`server on :${PORT}${MOCK ? " (MOCK mode)" : ""}`));
