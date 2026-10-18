/** SSE framing shared by the provider and browser; handles split UTF-8 and CRLF. */
export async function* sseData(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const interrupt = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', interrupt, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const {done,value} = await reader.read();
      signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value,{stream:true});
      buffer = buffer.replace(/\r\n/g,'\n');
      let end: number;
      while ((end=buffer.indexOf('\n\n'))>=0) {
        const event=buffer.slice(0,end);buffer=buffer.slice(end+2);
        const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(data) { signal?.throwIfAborted(); yield data; }
      }
      if(buffer.length>1_000_000) throw new Error('Stream frame too large');
      if(done) break;
    }
  } finally { signal?.removeEventListener('abort', interrupt);await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
