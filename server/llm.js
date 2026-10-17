// One interface over three providers, chosen with LLM_PROVIDER (anthropic | gemini | asi1).
//   structured({ system, messages, schema, effort }) -> object matching the zod schema
//   text({ system, messages, note, effort })          -> string; `note` is a per-turn instruction
// messages are [{ role: "user" | "assistant", content }].
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

export class LLMError extends Error {
  constructor(message, status, { missingKey = false } = {}) {
    super(message);
    this.status = status;
    this.missingKey = missingKey;
  }
}

const env = process.env;
export const PROVIDER =
  env.LLM_PROVIDER || (env.GEMINI_API_KEY ? "gemini" : env.ASI_ONE_API_KEY ? "asi1" : "anthropic");

const jsonSchemaOf = (schema) => {
  const { $schema, ...rest } = z.toJSONSchema(schema);
  return rest;
};

const parseJson = (raw, schema) => {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    const result = schema.safeParse(JSON.parse(cleaned));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

// Non-Anthropic JSON modes are best effort, so validate and retry once.
async function withRetry(call, schema) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = parseJson(await call(), schema);
    if (out) return out;
  }
  throw new LLMError("Model returned output that didn't match the expected format.", 502);
}

async function postJson(url, headers, body, name) {
  let res;
  // Connection failures (not HTTP errors) get one retry; some endpoints are slow to accept connections.
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt >= 1) {
        throw new LLMError(`Couldn't reach ${name} (${err.cause?.code || err.message}). Check your connection and try again.`, 503);
      }
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error?.message || data.detail || data.message || res.statusText;
    throw new LLMError(`${name} error ${res.status}: ${detail}`, res.status);
  }
  return data;
}

// --- Anthropic (SDK) ---------------------------------------------------------
function anthropicProvider() {
  const client = new Anthropic();
  const model = env.ANTHROPIC_MODEL || "claude-opus-5-5";
  // Server-side fallbacks cover the rare safety decline.
  const base = { model, max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
  const checkRefusal = (r) => {
    if (r.stop_reason === "refusal") throw new LLMError("The model declined to respond to that message.", 422);
  };
  return {
    model,
    async structured({ system, messages, schema, effort }) {
      const r = await client.beta.messages.parse({
        ...base,
        output_config: { effort, format: betaZodOutputFormat(schema) },
        system,
        messages,
      });
      checkRefusal(r);
      if (!r.parsed_output) throw new LLMError("Model returned unparseable output.", 502);
      return r.parsed_output;
    },
    async text({ system, messages, note, effort }) {
      // A mid-conversation system message keeps the cached prefix stable across turns.
      const msgs = note ? [...messages, { role: "system", content: note }] : messages;
      const r = await client.beta.messages.create({ ...base, output_config: { effort }, system, messages: msgs });
      checkRefusal(r);
      return r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    },
  };
}

// --- Google Gemini (REST generateContent) -------------------------------------
function geminiProvider() {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new LLMError("GEMINI_API_KEY is not set. Get a free key at aistudio.google.com/apikey.", 401, { missingKey: true });
  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  async function generate(system, messages, generationConfig) {
    const data = await postJson(
      url,
      { "x-goog-api-key": key },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig,
      },
      "Gemini"
    );
    const candidate = data.candidates?.[0];
    if (!candidate?.content) {
      throw new LLMError(`Gemini returned no answer (${candidate?.finishReason || data.promptFeedback?.blockReason || "unknown"}).`, 502);
    }
    return candidate.content.parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("").trim();
  }

  return {
    model,
    structured: ({ system, messages, schema }) =>
      withRetry(
        () => generate(system, messages, { responseMimeType: "application/json", responseJsonSchema: jsonSchemaOf(schema) }),
        schema
      ),
    text: ({ system, messages, note }) => generate(note ? `${system}\n\n${note}` : system, messages, {}),
  };
}

// --- Fetch.ai ASI:One (OpenAI-compatible chat completions) --------------------
function asi1Provider() {
  const key = env.ASI_ONE_API_KEY;
  if (!key) throw new LLMError("ASI_ONE_API_KEY is not set. Create a key at asi1.ai.", 401, { missingKey: true });
  const model = env.ASI_MODEL || "asi1";

  async function complete(system, messages, extra) {
    const data = await postJson(
      "https://api.asi1.ai/v1/chat/completions",
      { Authorization: `Bearer ${key}` },
      { model, messages: [{ role: "system", content: system }, ...messages], ...extra },
      "ASI:One"
    );
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new LLMError("ASI:One returned an empty answer.", 502);
    return content.trim();
  }

  return {
    model,
    structured: ({ system, messages, schema }) =>
      withRetry(
        () =>
          complete(system, messages, {
            response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: jsonSchemaOf(schema) } },
          }),
        schema
      ),
    text: ({ system, messages, note }) => complete(note ? `${system}\n\n${note}` : system, messages, {}),
  };
}

const PROVIDERS = { anthropic: anthropicProvider, gemini: geminiProvider, asi1: asi1Provider };

let instance;
export function llm() {
  if (!PROVIDERS[PROVIDER]) throw new LLMError(`Unknown LLM_PROVIDER "${PROVIDER}". Use anthropic, gemini or asi1.`, 500);
  instance ??= PROVIDERS[PROVIDER]();
  return instance;
}

export function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "No valid Anthropic API key. Add ANTHROPIC_API_KEY to .env, or set MOCK=1.";
  if (err instanceof Anthropic.RateLimitError || err.status === 429) {
    return "Rate limited by the AI provider (free tiers have low limits). Wait a moment and try again.";
  }
  if (err.missingKey) return err.message;
  if (err.status === 401 || err.status === 403) return `The ${PROVIDER} API key was rejected: ${err.message}`;
  return err.message || "Something went wrong.";
}
