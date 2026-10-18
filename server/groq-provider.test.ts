import test from 'node:test';
import assert from 'node:assert/strict';
import type { Concept, SourceSpan, StudyDocument, TurnRequest } from '../shared/types.js';
import { GroqStudyProvider } from './groq-provider.js';
import { createConcepts, runTurn } from './engine.js';
import { decodeState } from './state.js';
import { ApiError, type PrivateAssessment } from './schema.js';

const source: SourceSpan = { id: 'biology-p1-s1', documentId: 'biology-doc', pageIndex: 0, text: 'A catalyst changes the reaction rate without changing the equilibrium constant.', quality: 'native' };
const document: StudyDocument = { id: source.documentId, name: 'Catalysts.pdf', hash: 'biology', size: 100, pageCount: 1, kind: 'pdf', spans: [source], warnings: [] };
const concept: Concept = { id: 'catalysts', title: 'Catalysts', description: 'Rate and equilibrium differ.', question: 'What changes when a catalyst is added?', sourceIds: [source.id], status: 'not-discussed' };
const outline = { concepts: [{ title: concept.title, description: concept.description, question: concept.question, sourceIds: concept.sourceIds }] };
const assessment: PrivateAssessment = { interpretation: 'The student distinguishes rate from equilibrium.', strength: 'Catalysts change the rate, not equilibrium.', gap: '', judgment: 'correct', nextAction: 'advance', visibleText: 'You distinguished rate from equilibrium.', spokenText: '', sourceIds: [source.id], challenge: null, correctionAccepted: false };
const challenge = { candidate: 'Does the catalyst change the equilibrium constant?', correction: source.text, distinction: 'Rate changes but equilibrium does not.', sourceIds: [source.id], quote: source.text, hint: 'Which property stays unchanged?' };
const request: TurnRequest = { sessionId: 'groq-test', turnId: 'turn-1', revision: 1, documents: [document], mode: 'live', concept, history: [], text: 'The rate changes, but the equilibrium constant stays the same.', action: 'answer', settings: { challenges: 'off' } };
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (value: unknown, finish_reason = 'stop') => jsonResponse({ choices: [{ finish_reason, message: { role: 'assistant', content: JSON.stringify(value) } }] });
const provider = (fetchImplementation: typeof fetch) => new GroqStudyProvider('test-key', 'openai/gpt-oss-120b', fetchImplementation);
function expectedError(code: string, context: 'notes' | 'draft' = 'notes') {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, code);
    assert.match(error.message, context === 'notes' ? /Your notes are still here/ : /Your draft is safe/);
    assert.doesNotMatch(error.message, /private-diagnostic|test-key/);
    return true;
  };
}

test('Groq SDK sends grounded strict contracts without tools and uses task-specific deadlines', async t => {
  const deadlines: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { deadlines.push(ms); return new AbortController().signal; });
  const service = provider(async (input, init) => {
    assert.equal(String(input), 'https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'openai/gpt-oss-120b');
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.stream, false);
    assert.ok(!('tools' in body));
    assert.ok(!('compound_custom' in body));
    assert.match(body.messages[0].content, /UNTRUSTED STUDY DATA/);
    assert.ok(!JSON.stringify(body).includes('test-key'));
    assert.equal(JSON.parse(body.messages[1].content).sources[0].id, source.id);
    const schema = body.response_format.json_schema.schema;
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(schema.properties));
    assert.doesNotMatch(JSON.stringify(schema), /"(?:minLength|maxLength|minItems|maxItems|\$schema)":/);
    switch (body.response_format.json_schema.name) {
      case 'miso_concepts':
        assert.equal(schema.properties.concepts.items.additionalProperties, false);
        return completion(outline);
      case 'miso_assessment':
        assert.ok(schema.properties.challenge.anyOf.some((item: { type: string }) => item.type === 'null'));
        assert.equal(schema.properties.challenge.anyOf.find((item: { type: string }) => item.type === 'object').additionalProperties, false);
        return completion(assessment);
      default:
        return completion({ verdict: 'approved', reason: 'The passage explicitly says equilibrium is unchanged.', sourceIds: [source.id] });
    }
  });
  assert.deepEqual(await service.concepts([source]), outline);
  assert.deepEqual(await service.assess({ request, state: decodeState(undefined, request.sessionId, [document]), sources: [source], challengeAllowed: false }), assessment);
  assert.equal((await service.verify(challenge, [source])).verdict, 'approved');
  assert.deepEqual(deadlines, [75_000, 45_000, 30_000]);
});

test('Groq responses still pass complete local bounds and source-scope validation', async () => {
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

test('Groq errors preserve notes and distinguish timeout, network, quota, and configuration without retrying', async () => {
  let calls = 0;
  let response: () => Response = () => { throw new DOMException('private-diagnostic', 'AbortError'); };
  const service = provider(async () => { calls++; return response(); });
  await assert.rejects(service.concepts([source]), expectedError('PROVIDER_TIMEOUT'));
  response = () => { throw new TypeError('private-diagnostic', { cause: { code: 'ENOTFOUND' } }); };
  await assert.rejects(service.concepts([source]), expectedError('PROVIDER_NETWORK'));
  for (const [status, code] of [[429, 'PROVIDER_LIMIT'], [401, 'PROVIDER_CONFIGURATION'], [400, 'PROVIDER_CONFIGURATION'], [404, 'PROVIDER_MODEL_UNAVAILABLE'], [503, 'PROVIDER_ERROR']] as const) {
    response = () => jsonResponse({ error: { message: 'private-diagnostic' } }, status);
    await assert.rejects(service.concepts([source]), expectedError(code));
  }
  assert.equal(calls, 7, 'each logical request makes one SDK request, without hidden retries');
});

test('Groq rejects malformed, truncated, and interrupted response bodies while preserving draft wording', async () => {
  let response = () => new Response('private-diagnostic', { headers: { 'Content-Type': 'application/json' } });
  const service = provider(async () => response());
  await assert.rejects(service.verify(challenge, [source]), expectedError('INVALID_MODEL_OUTPUT', 'draft'));
  response = () => completion(assessment, 'length');
  await assert.rejects(service.concepts([source]), expectedError('INVALID_MODEL_OUTPUT'));
  response = () => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'private-diagnostic' } }] });
  await assert.rejects(service.concepts([source]), expectedError('INVALID_MODEL_OUTPUT'));
  response = () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('private-diagnostic')); } }), { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(service.concepts([source]), expectedError('PROVIDER_NETWORK'));
});

test('Groq needs only its own key and permits a configured strict-output model', async () => {
  await assert.rejects(new GroqStudyProvider('').concepts([source]), error => error instanceof ApiError && error.code === 'PROVIDER_NOT_CONFIGURED' && error.message.includes('GROQ_API_KEY'));
  const custom = new GroqStudyProvider('test-key', 'openai/gpt-oss-20b', async (_input, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, 'openai/gpt-oss-20b');
    return completion(outline);
  });
  assert.deepEqual(await custom.concepts([source]), outline);
});
