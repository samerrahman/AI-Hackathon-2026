async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const prepareTopic = (title, notes) => post("/api/topics/prepare", { title, notes });

export const sendChat = (topic, messages, mode) =>
  post("/api/chat", {
    topic: {
      title: topic.title,
      notes: topic.notes,
      concepts: topic.concepts,
      understood: topic.understood,
      teachLog: mode === "review" ? topic.teachLog : undefined,
    },
    messages,
    mode,
  });
