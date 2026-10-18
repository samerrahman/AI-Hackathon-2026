/** Speech requests are bounded sentences/phrases, never token-by-token fragments. */
export function speechChunks(text: string, limit = 350): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('Invalid speech chunk limit');
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const prefix = rest.slice(0, limit);
    const sentence = [...prefix.matchAll(/[.!?](?:["'”’])?\s+/g)].at(-1);
    const space = [...prefix.matchAll(/\s+/g)].at(-1);
    let end = sentence && sentence.index + sentence[0].length >= limit / 3
      ? sentence.index + sentence[0].length : space && space.index > 0 ? space.index + space[0].length : limit;
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  if (rest) chunks.push(rest);
  return chunks;
}
