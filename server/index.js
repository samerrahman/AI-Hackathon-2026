import express from "express";
import { z } from "zod";
import { llm, PROVIDER, friendlyError } from "./llm.js";
import {
  STUDENT_NAME,
  DEPTHS,
  depthOf,
  prepareSystem,
  judgeSystem,
  stuSystem,
  stuDirection,
  reviewSystem,
} from "./prompts.js";
import { allItems, stageOf } from "./rubric.js";
import { mockPrepare, mockJudge, mockReply } from "./mock.js";

// The judge is the part that has to be right, so it thinks harder than Stu does.
const JUDGE_EFFORT = "medium";
const STU_EFFORT = "low";
const MOCK = process.env.MOCK === "1";

const RubricSchema = z.object({
  ideas: z.array(z.object({ id: z.string(), name: z.string(), cover: z.string(), explain: z.string() })),
  connections: z.array(
    z.object({ id: z.string(), name: z.string(), ideas: z.array(z.string()), explain: z.string() })
  ),
});

const VerdictSchema = z.object({
  credited: z.array(z.object({ item: z.string(), evidence: z.string() })),
  revoked: z.array(z.string()),
  problems: z.array(
    z.object({
      kind: z.enum(["wrong", "vague", "missing_step", "undefined_term", "off_topic"]),
      quote: z.string(),
      note: z.string(),
    })
  ),
  stuFocus: z.string(),
  stuMistake: z.string(),
});

function itemName(topic, item) {
  const [kind, id] = item.split(":");
  if (kind === "link") return topic.connections.find((k) => k.id === id)?.name;
  const idea = topic.ideas.find((i) => i.id === id)?.name;
  return kind === "cover" ? `what "${idea}" is` : `how "${idea}" works`;
}

// Evidence has to be something the teacher actually typed, so the judge can't credit from vibes.
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const quotedByTeacher = (evidence, teacherText) => {
  const q = normalize(evidence);
  return q.split(" ").length >= 3 && teacherText.includes(q);
};

const transcript = (messages) =>
  messages
    .map((m, i) => {
      const who = m.role === "user" ? "Teacher" : STUDENT_NAME;
      const tag = i === messages.length - 1 ? " (NEWEST)" : "";
      return `${who}${tag}: ${m.content}`;
    })
    .join("\n\n");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  let model = null;
  try {
    model = MOCK ? "mock" : llm().model;
  } catch {
    /* missing key; reported when a request is made */
  }
  res.json({ ok: true, mock: MOCK, provider: MOCK ? "mock" : PROVIDER, model, student: STUDENT_NAME });
});

app.get("/api/depths", (_req, res) =>
  res.json(Object.entries(DEPTHS).map(([key, d]) => ({ key, label: d.label, blurb: d.blurb })))
);

// Turn course notes into a depth-specific rubric: ideas to cover and explain, plus connections.
app.post("/api/topics/prepare", async (req, res, next) => {
  try {
    const { title, notes, depth: depthKey } = req.body;
    if (!title?.trim() || !notes?.trim()) {
      return res.status(400).json({ error: "Title and notes are required." });
    }
    if (MOCK) return res.json(mockPrepare(title));
    const out = await llm().structured({
      system: prepareSystem(depthOf(depthKey)),
      messages: [{ role: "user", content: `Topic: ${title}\n\nCourse notes:\n${notes}` }],
      schema: RubricSchema,
      effort: "medium",
    });
    // Renumber ids so the client can rely on them, keeping connection references intact.
    const idMap = new Map(out.ideas.map((idea, n) => [idea.id, `i${n + 1}`]));
    const ideas = out.ideas.map((idea) => ({ ...idea, id: idMap.get(idea.id) }));
    const connections = out.connections
      .map((k, n) => ({ ...k, id: `k${n + 1}`, ideas: k.ideas.map((id) => idMap.get(id)).filter(Boolean) }))
      .filter((k) => k.ideas.length > 0);
    res.json({ ideas, connections });
  } catch (err) {
    next(err);
  }
});

// mode "teach": hidden judge grades the teacher, then Stu reacts in character.
// mode "review": topic is complete; Stu explains it back so the user can re-learn.
app.post("/api/chat", async (req, res, next) => {
  try {
    const { topic, messages, mode } = req.body;
    if (!topic || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "topic and messages are required." });
    }
    const depth = depthOf(topic.depth);
    const chat = messages.map((m) => ({ role: m.role, content: m.content }));

    if (mode === "review") {
      const reply = MOCK
        ? mockReply(chat, "review")
        : await llm().text({ system: reviewSystem(topic, depth), messages: chat, effort: STU_EFFORT });
      return res.json({ reply, credited: [], revoked: [], problems: [] });
    }

    // 1. Judge
    const raw = MOCK
      ? mockJudge(topic, chat)
      : await llm().structured({
          system: judgeSystem(topic, depth),
          messages: [{ role: "user", content: `Conversation so far:\n\n${transcript(chat)}` }],
          schema: VerdictSchema,
          effort: JUDGE_EFFORT,
        });

    const valid = new Set(allItems(topic));
    const teacherText = normalize(chat.filter((m) => m.role === "user").map((m) => m.content).join(" \n "));
    const credited = { ...topic.credited };
    const newly = [];
    for (const c of raw.credited) {
      if (!valid.has(c.item) || credited[c.item]) continue;
      if (!MOCK && !quotedByTeacher(c.evidence, teacherText)) {
        console.warn(`judge credit rejected, evidence not in teacher's words: ${c.item} "${c.evidence}"`);
        continue;
      }
      credited[c.item] = c.evidence;
      newly.push(c);
      // Explaining an idea necessarily names it.
      const [kind, id] = c.item.split(":");
      if (kind === "explain" && !credited[`cover:${id}`]) {
        credited[`cover:${id}`] = c.evidence;
        newly.push({ item: `cover:${id}`, evidence: c.evidence });
      }
    }
    const revoked = raw.revoked.filter((id) => credited[id] && !newly.some((c) => c.item === id));
    for (const id of revoked) delete credited[id];

    // 2. Stu, who only ever sees the conversation and the director note, never the notes.
    const stage = stageOf(topic, credited);
    const verdict = {
      creditedNames: newly
        .filter((c) => !newly.some((o) => o.item === c.item.replace(/^cover:/, "explain:") && o !== c))
        .map((c) => itemName(topic, c.item)),
      stuFocus: raw.stuFocus,
      stuMistake: raw.stuMistake,
    };
    const reply = MOCK
      ? mockReply(chat, "teach", verdict)
      : await llm().text({
          system: stuSystem(topic),
          messages: chat,
          note: stuDirection(verdict, stage),
          effort: STU_EFFORT,
        });

    res.json({ reply, credited: newly, revoked, problems: raw.problems });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({ error: friendlyError(err) });
});

const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => console.log(`server on :${PORT} using ${MOCK ? "MOCK mode" : PROVIDER}`));
