// Canned responses for MOCK=1, so the UI can be built without an API key.
import { allItems } from "./rubric.js";

export function mockPrepare(title) {
  const ideas = ["What it is", "How it works", "Why it matters"].map((name, n) => ({
    id: `i${n + 1}`,
    name,
    cover: `Mock: name "${name}" for ${title}.`,
    explain: `Mock: explain "${name}" for ${title}.`,
  }));
  const connections = [
    { id: "k1", name: "How it works → why it matters", ideas: ["i2", "i3"], explain: "Mock connection." },
  ];
  return { ideas, connections };
}

// Any message over 60 characters earns the next uncredited item.
export function mockJudge(topic, chat) {
  const last = chat[chat.length - 1].content;
  const next = allItems(topic).find((id) => !topic.credited[id]);
  if (next && last.length > 60) {
    return { credited: [{ item: next, evidence: last.split(" ").slice(0, 8).join(" ") }], revoked: [], problems: [], stuFocus: "", stuMistake: "" };
  }
  return {
    credited: [],
    revoked: [],
    problems: [{ kind: "vague", quote: last, note: "Mock: too short to count." }],
    stuFocus: "what that even means",
    stuMistake: "",
  };
}

const confused = [
  "Wait, so is it like a sandwich? Everything I know is kind of like a sandwich.",
  "Hmm, I wrote that down but I think I wrote it upside down. Can you say it a different way?",
  "Oh! So it's always true, for everything, forever? That's what you meant, right?",
  "What does that word mean? You used a word and my brain just went blank.",
];

export function mockReply(chat, mode, verdict) {
  if (mode === "review") return `(mock) Ooh, I remember this stuff! Want me to quiz you?`;
  if (verdict.creditedNames.length) return `Ohhh! Now I get ${verdict.creditedNames.join(" and ")}! (mock)`;
  return confused[chat.length % confused.length];
}
