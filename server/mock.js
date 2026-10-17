// Canned responses for MOCK=1, so the UI can be built without an API key.

export function mockPrepare(title) {
  return {
    concepts: ["What it is", "How it works", "Why it matters"].map((name, i) => ({
      id: `c${i + 1}`,
      name: `${name}`,
      mustExplain: `Mock rubric for "${title}" part ${i + 1}.`,
    })),
  };
}

const confused = [
  "Wait, so is it like a sandwich? Everything I know is kind of like a sandwich.",
  "Hmm, I wrote that down but I think I wrote it upside down. Can you say it a different way?",
  "Oh! So it's always true, for everything, forever? That's what you meant, right?",
  "What does that word mean? You used a word and my brain just went blank.",
];

export function mockChat(topic, messages, mode) {
  const last = messages[messages.length - 1]?.content ?? "";
  if (mode === "review") {
    return { reply: `(mock) Ooh, I remember this! You told me: "${last.slice(0, 60)}". Want me to quiz you?`, newlyUnderstood: [] };
  }
  // Any long-ish message teaches the next concept.
  const next = topic.concepts.find((c) => !topic.understood.includes(c.id));
  if (next && last.length > 60) {
    return { reply: `Ohhh! So "${next.name}" is about what you just said. I think I get it now! (mock)`, newlyUnderstood: [next.id] };
  }
  return { reply: confused[messages.length % confused.length], newlyUnderstood: [] };
}
