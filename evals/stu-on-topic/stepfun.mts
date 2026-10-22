// A minimal StepFun chat-completions client for the eval's own calls (the teacher simulator and the grader).
// The app's calls go through server/teach-provider.ts unchanged. The key is only ever sent as the auth header.

export interface ChatOptions {
  model: string; messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  maxTokens: number; timeoutMs?: number; jsonSchema?: { name: string; schema: unknown };
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** One completion's final text, retrying rate limits, server errors, timeouts, and empty or cut-off answers. */
export async function chat(options: ChatOptions): Promise<{ content: string; ms: number; attempts: number }> {
  const key = process.env.STEPFUN_API_KEY?.trim();
  if (!key) throw new Error('STEPFUN_API_KEY is not set');
  const baseUrl = (process.env.STEPFUN_BASE_URL || 'https://api.stepfun.ai/v1').replace(/\/+$/, '');
  const start = performance.now();
  let problem = '';
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: options.model, messages: options.messages, max_tokens: options.maxTokens, reasoning_effort: 'low',
          ...(options.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: options.jsonSchema.name, strict: true, schema: options.jsonSchema.schema } } } : {}) }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
      });
      if (!response.ok) {
        problem = `HTTP ${response.status}`;
        if ([400, 401, 402, 403, 404].includes(response.status)) break;
        await sleep(response.status === 429 ? 5_000 * 2 ** (attempt - 1) : 2_000);
        continue;
      }
      const body = await response.json() as { choices?: { finish_reason?: string; message?: { content?: string | null } }[] };
      const choice = body.choices?.[0];
      const content = (choice?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (choice?.finish_reason === 'stop' && content) return { content, ms: Math.round(performance.now() - start), attempts: attempt };
      problem = `finish_reason ${choice?.finish_reason ?? 'missing'}, ${content.length} chars`;
    } catch (error) {
      problem = error instanceof Error ? error.name : 'request failed';
      await sleep(2_000);
    }
  }
  throw new Error(`StepFun ${options.model} call failed (${problem})`);
}
