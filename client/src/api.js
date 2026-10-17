async function request(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const getDepths = () => request("/api/depths");

export const getHealth = () => request("/api/health");

export const prepareTopic = (title, notes, depth) => request("/api/topics/prepare", { title, notes, depth });

export const sendChat = (topic, messages, mode) =>
  request("/api/chat", {
    topic: {
      title: topic.title,
      notes: topic.notes,
      depth: topic.depth,
      ideas: topic.ideas,
      connections: topic.connections,
      credited: topic.credited,
      teachLog: mode === "review" ? topic.teachLog : undefined,
    },
    messages,
    mode,
  });
