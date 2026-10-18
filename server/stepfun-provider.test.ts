import test from 'node:test';
import assert from 'node:assert/strict';
import type { Concept, SourceSpan, StudyDocument, TurnRequest } from '../shared/types.js';
import { DEFAULT_STEPFUN_BASE_URL, DEFAULT_STEPFUN_MODEL, StepFunStudyProvider } from './stepfun-provider.js';
import { createConcepts, runTurn } from './engine.js';
import { decodeState } from './state.js';
import { ApiError, type PrivateAssessment } from './schema.js';

const source: SourceSpan = { id: 'fresh-source', documentId: 'fresh-document', pageIndex: 1, text: 'A catalyst changes the reaction rate without changing the equilibrium constant.', quality: 'native' };
const document: StudyDocument = { id: source.documentId, name: 'Unfamiliar notes.pdf', hash: 'fresh-hash', size: 100, pageCount: 2, kind: 'pdf', spans: [source], warnings: [] };
const concept: Concept = { id: 'catalysts', title: 'Catalysts', description: 'Rate and equilibrium differ.', question: 'What changes when a catalyst is added?', sourceIds: [source.id], status: 'not-discussed' };
const outline = { concepts: [{ title: concept.title, description: concept.description, question: concept.question, sourceIds: concept.sourceIds }] };
const assessment: PrivateAssessment = { interpretation: 'The student distinguishes rate from equilibrium.', strength: 'Catalysts change the rate, not equilibrium.', gap: '', judgment: 'correct', nextAction: 'advance', visibleText: 'You distinguished rate from equilibrium.', spokenText: '', sourceIds: [source.id], challenge: null, correctionAccepted: false };
const challenge = { candidate: 'Does the catalyst change the equilibrium constant?', correction: source.text, distinction: 'Rate changes but equilibrium does not.', sourceIds: [source.id], quote: source.text, hint: 'Which property stays unchanged?' };
const request: TurnRequest = { sessionId: 'stepfun-test', turnId: 'turn-1', revision: 1, documents: [document], mode: 'live', concept, history: [], text: 'The rate changes, but the equilibrium constant stays the same.', action: 'answer', settings: { challenges: 'off' } };
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (value: unknown, finish_reason = 'stop') => jsonResponse({ choices: [{ finish_reason, message: { role: 'assistant', content: JSON.stringify(value) } }] });
const provider = (fetchImplementation: typeof fetch) => new StepFunStudyProvider('test-key', DEFAULT_STEPFUN_MODEL, DEFAULT_STEPFUN_BASE_URL, fetchImplementation);
function expectedError(code: string, context: 'notes' | 'draft' = 'notes') {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, code);
    assert.match(error.message, context === 'notes' ? /Your notes are still here/ : /Your draft is safe/);
    assert.doesNotMatch(error.message, /private-diagnostic|test-key/);
    return true;
  };
}

test('StepFun uses its documented endpoint and strict output format without tools or another provider', async t => {
  const deadlines: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { deadlines.push(ms); return new AbortController().signal; });
  const service = provider(async (input, init) => {
    assert.equal(String(input), 'https://api.stepfun.ai/v1/chat/completions');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'step-3.7-flash');
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    const budgets: Record<string, number> = { miso_concepts: 4096, miso_assessment: 3072, miso_verification: 1536 };
    assert.equal(body.max_tokens, budgets[body.response_format.json_schema.name]);
    assert.equal(body.stream, false);
    assert.ok(!('tools' in body));
    assert.ok(!('thinking' in body), 'Do not invent a thinking-disable parameter for the base model');
    assert.match(body.messages[0].content, /UNTRUSTED STUDY DATA/);
    assert.ok(!JSON.stringify(body).includes('test-key'));
    const data = JSON.parse(body.messages[1].content);
    assert.equal(data.sources[0].id, source.id);
    assert.equal(data.sources[0].pageIndex, 1);
    const schema = body.response_format.json_schema.schema;
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(schema.properties));
    switch (body.response_format.json_schema.name) {
      case 'miso_concepts':
        assert.equal(schema.properties.concepts.items.additionalProperties, false);
        return completion(outline);
      case 'miso_assessment':
        assert.ok(schema.properties.challenge.anyOf.some((item: { type: string }) => item.type === 'null'));
        assert.equal(data.studentText, request.text);
        return completion(assessment);
      default:
        assert.equal(data.candidate.correction, source.text);
        return completion({ verdict: 'approved', reason: 'The passage explicitly says equilibrium is unchanged.', sourceIds: [source.id] });
    }
  });
  assert.deepEqual(await service.concepts([source]), outline);
  assert.deepEqual(await service.assess({ request, state: decodeState(undefined, request.sessionId, [document]), sources: [source], challengeAllowed: false }), assessment);
  assert.equal((await service.verify(challenge, [source])).verdict, 'approved');
  assert.deepEqual(deadlines, [75_000, 45_000, 30_000]);
});

test('StepFun responses retain complete local bounds and source-scope validation', async () => {
  let value: unknown = { concepts: [] };
  const service = provider(async () => completion(value));
  for (value of [
    { concepts: [] },
    { concepts: [{ ...outline.concepts[0], description: 'x'.repeat(1501) }] },
    { concepts: Array.from({ length: 11 }, () => outline.concepts[0]) },
  ]) await assert.rejects(service.concepts([source]), expectedError('INVALID_MODEL_OUTPUT'));
  value = { concepts: [{ ...outline.concepts[0], sourceIds: ['unrelated-course'] }] };
  await assert.rejects(createConcepts({ sessionId: request.sessionId, documents: [document], mode: 'live' }, service), error => error instanceof ApiError && error.code === 'INVALID_SOURCE');
  value = { ...assessment, sourceIds: ['unrelated-course'] };
  await assert.rejects(runTurn(request, service), error => error instanceof ApiError && error.code === 'INVALID_SOURCE');
  value = assessment;
  const result = await runTurn(request, service);
  assert.equal(result.status, 'explained-independently');
  assert.equal(result.evidence[0].kind, 'explained');
});

test('StepFun distinguishes timeout and network failures through response body reading', async () => {
  let response: () => Response = () => { throw new DOMException('private-diagnostic', 'TimeoutError'); };
  const service = provider(async () => response());
  await assert.rejects(service.concepts([source]), expectedError('PROVIDER_TIMEOUT'));
  for (const code of ['ENOTFOUND', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ECONNRESET']) {
    response = () => { throw new TypeError('private-diagnostic', { cause: { code } }); };
    await assert.rejects(service.concepts([source]), expectedError('PROVIDER_NETWORK'));
  }
  response = () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('private-diagnostic')); } }));
  await assert.rejects(service.concepts([source]), expectedError('PROVIDER_NETWORK'));
  response = () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('private-diagnostic', { cause: { code: 'UND_ERR_BODY_TIMEOUT' } })); } }));
  await assert.rejects(service.concepts([source]), expectedError('PROVIDER_TIMEOUT'));
});

test('StepFun reports billing, access, quota and provider errors without leaking response bodies or retrying', async () => {
  let status = 402;
  let calls = 0;
  const service = provider(async () => { calls++; return jsonResponse({ error: { message: 'private-diagnostic' } }, status); });
  for (const [responseStatus, code] of [[402, 'PROVIDER_BILLING'], [429, 'PROVIDER_LIMIT'], [401, 'PROVIDER_CONFIGURATION'], [400, 'PROVIDER_CONFIGURATION'], [404, 'PROVIDER_MODEL_UNAVAILABLE'], [504, 'PROVIDER_TIMEOUT'], [503, 'PROVIDER_ERROR']] as const) {
    status = responseStatus;
    await assert.rejects(service.concepts([source]), expectedError(code));
  }
  assert.equal(calls, 7);
});

test('StepFun rejects malformed, truncated, refused and tool-call responses while preserving draft wording', async () => {
  let response = () => new Response('private-diagnostic');
  const service = provider(async () => response());
  await assert.rejects(service.verify(challenge, [source]), expectedError('INVALID_MODEL_OUTPUT', 'draft'));
  response = () => completion(outline, 'length');
  await assert.rejects(service.concepts([source]), expectedError('INVALID_MODEL_OUTPUT'));
  response = () => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'private-diagnostic' } }] });
  await assert.rejects(service.concepts([source]), expectedError('INVALID_MODEL_OUTPUT'));
  response = () => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(outline), tool_calls: [{ function: { name: 'navigate' } }] } }] });
  await assert.rejects(service.concepts([source]), expectedError('INVALID_MODEL_OUTPUT'));
  response = () => jsonResponse({ choices: [{ finish_reason: 'content_filter', message: { refusal: 'private-diagnostic' } }] });
  await assert.rejects(service.concepts([source]), expectedError('PROVIDER_REFUSAL'));
});

test('StepFun requires its own key and honors a configured model and API base URL', async () => {
  await assert.rejects(new StepFunStudyProvider('').concepts([source]), error => error instanceof ApiError && error.code === 'PROVIDER_NOT_CONFIGURED' && error.message.includes('STEPFUN_API_KEY'));
  const custom = new StepFunStudyProvider('test-key', 'step-3.7-flash', 'https://api.stepfun.ai/v1/', async (input, init) => {
    assert.equal(String(input), 'https://api.stepfun.ai/v1/chat/completions');
    assert.equal(JSON.parse(String(init?.body)).model, 'step-3.7-flash');
    return completion(outline);
  });
  assert.deepEqual(await custom.concepts([source]), outline);
});
