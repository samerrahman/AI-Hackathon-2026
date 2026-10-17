// Every gradeable item for a topic: cover + explain per idea, then each connection.
export function allItems(topic) {
  return [
    ...topic.ideas.flatMap((i) => [`cover:${i.id}`, `explain:${i.id}`]),
    ...topic.connections.map((k) => `link:${k.id}`),
  ];
}

export function stageOf(topic, credited) {
  const has = (id) => Boolean(credited[id]);
  if (!topic.ideas.every((i) => has(`cover:${i.id}`))) return "cover";
  if (!topic.ideas.every((i) => has(`explain:${i.id}`))) return "explain";
  if (!topic.connections.every((k) => has(`link:${k.id}`))) return "connect";
  return "done";
}
