import test from 'node:test';
import assert from 'node:assert/strict';
import type { SourceSpan } from '../shared/types.js';
import { StepFunProvider, type AssessmentContext } from './provider.js';
import { ApiError, type ChallengeCandidate } from './schema.js';

const source: SourceSpan = { id: 'source-1', documentId: 'doc-1', pageIndex: 0, text: 'Both switches are required to turn on the lamp.', quality: 'native' };
const candidate: ChallengeCandidate = {
  candidate: 'Would one switch alone turn on the lamp?', correction: 'Both switches are required to turn on the lamp.',
  distinction: 'One switch is insufficient.', sourceIds: [source.id], quote: source.text,
  hint: 'How many switches does the source require?',
};
const context = {
  request: { concept: { id: 'concept-1' }, action: 'answer', text: 'Both switches are required.', history: [] },
  state: { support: {}, pending: null, statuses: {} }, sources: [source], challengeAllowed: false,
} as unknown as AssessmentContext;
const completion = (content: unknown, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }), { status: 200 });

async function withFetch<T>(stub: typeof fetch, work: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await work(); } finally { globalThis.fetch = original; }
}

test('StepFun request uses strict schema, configured endpoint and model, and keeps credentials out of the body', async () => {
  let url = ''; let headers = new Headers(); let body: Record<string, any> = {};
  const provider = new StepFunProvider('private-test-key', 'step-5-preview', 'https://api.stepfun.ai/v1/');
  await withFetch(async (input, init) => {
    url = String(input); headers = new Headers(init?.headers); body = JSON.parse(String(init?.body));
    return completion({ concepts: [{ title: 'Lamp circuit', description: 'Both switches.', question: 'What turns on the lamp?', sourceIds: [source.id] }] });
  }, async () => {
    const result = await provider.concepts([source]);
    assert.equal(result.concepts[0].title, 'Lamp circuit');
  });
  assert.equal(url, 'https://api.stepfun.ai/v1/chat/completions');
  assert.equal(headers.get('Authorization'), 'Bearer private-test-key');
  assert.equal(body.model, 'step-5-preview');
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.required, ['concepts']);
  assert.match(body.messages[0].content, /UNTRUSTED STUDY DATA/);
  assert.ok(!JSON.stringify(body).includes('private-test-key'));
  assert.equal(provider.successfulResponses, 1);
});

test('all three live outputs require valid complete JSON and Zod contracts', async () => {
  const provider = new StepFunProvider('private-test-key');
  await withFetch(async () => completion({ wrong: 'shape' }), async () => {
    for (const call of [() => provider.concepts([source]), () => provider.assess(context), () => provider.verify(candidate, [source])]) {
      await assert.rejects(call(), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_MODEL_OUTPUT');
    }
  });
  await withFetch(async () => completion('{broken json'), async () => {
    await assert.rejects(provider.concepts([source]), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_MODEL_OUTPUT');
  });
  await withFetch(async () => completion({ concepts: [] }, 'length'), async () => {
    await assert.rejects(provider.concepts([source]), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_MODEL_OUTPUT');
  });
  assert.equal(provider.successfulResponses, 0);
});

test('provider failures map to safe messages without leaking response bodies', async () => {
  const provider = new StepFunProvider('private-test-key');
  for (const [status, code] of [[401, 'PROVIDER_AUTH'], [402, 'PROVIDER_BALANCE'], [429, 'PROVIDER_LIMIT'], [400, 'PROVIDER_CONFIGURATION'], [503, 'PROVIDER_ERROR']] as const) {
    await withFetch(async () => new Response('private provider detail', { status }), async () => {
      await assert.rejects(provider.concepts([source]), (error: unknown) => error instanceof ApiError && error.code === code && !error.message.includes('private provider detail') && !error.message.includes('private-test-key'));
    });
  }
  await withFetch(async () => { throw new Error('private network detail'); }, async () => {
    await assert.rejects(provider.concepts([source]), (error: unknown) => error instanceof ApiError && error.code === 'PROVIDER_ERROR' && !error.message.includes('private network detail'));
  });
  await withFetch(async () => { throw new DOMException('private timeout detail', 'TimeoutError'); }, async () => {
    await assert.rejects(provider.concepts([source]), (error: unknown) => error instanceof ApiError && error.code === 'PROVIDER_TIMEOUT' && !error.message.includes('private timeout detail'));
  });
  await assert.rejects(new StepFunProvider('').concepts([source]), (error: unknown) => error instanceof ApiError && error.code === 'PROVIDER_NOT_CONFIGURED');
});
