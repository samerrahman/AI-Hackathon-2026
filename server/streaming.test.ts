import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTick, setTimeout as delay } from 'node:timers/promises';
import type { Concept, ProviderTiming, SourceSpan, StudyDocument, TurnRequest } from '../shared/types.js';
import { sseData } from '../shared/stream.js';
import { readReplyPrefix } from './partial-json.js';
import { CollectionCache } from './collections.js';
import { StepFunStudyProvider } from './stepfun-provider.js';
import { runTurn } from './engine.js';
import { decodeState, encodeState } from './state.js';
import { ApiError, type PrivateAssessment } from './schema.js';

process.env.SESSION_SECRET = 'stream-tests-only';
const encoder = new TextEncoder();
const source: SourceSpan = { id: 'native-source', documentId: 'native-doc', pageIndex: 0, text: 'A catalyst changes the reaction rate without changing the equilibrium constant.', quality: 'native' };
const document: StudyDocument = { id: 'native-doc', hash: 'native-hash', name: 'Catalysts', size: 100, pageCount: 1, kind: 'text', spans: [source], warnings: [] };
const concept: Concept = { id: 'catalysts', title: 'Catalysts', description: 'Rate versus equilibrium.', question: 'What changes when we add a catalyst?', sourceIds: [source.id], status: 'not-discussed' };
const request = (overrides: Partial<TurnRequest> = {}): TurnRequest => ({ sessionId: 'stream-session', turnId: crypto.randomUUID(), revision: 1, documents: [document], mode: 'live', concept, text: 'The rate changes, but the equilibrium constant stays the same.', action: 'answer', history: [], settings: { challenges: 'off' }, ...overrides });
const assessment: PrivateAssessment = { judgment: 'correct', sourceIds: [source.id], nextAction: 'advance', challenge: null, visibleText: 'Oh, the rate changes while equilibrium stays put.', interpretation: 'PRIVATE_INTERPRETATION', strength: 'Distinguishes rate from equilibrium.', gap: '', spokenText: '', correctionAccepted: false };
const challenge = { candidate: 'So a catalyst changes the equilibrium constant?', correction: source.text, distinction: 'Rate changes, while the equilibrium constant stays unchanged.', sourceIds: [source.id], quote: source.text, hint: 'Which property does the passage say stays the same?' };
const frame = (value: unknown) => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\r\n\r\n`;
const delta = (content: string) => frame({ choices: [{ delta: { content } }] });
const finish = () => frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 170, completion_tokens: 45 } }) + frame('[DONE]');
function streamResponse(text: string, bytesPerChunk = 7) {
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += bytesPerChunk) controller.enqueue(bytes.slice(i, i + bytesPerChunk));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const service = (fetcher: typeof fetch) => new StepFunStudyProvider('fake-key', 'step-3.5-flash', 'https://provider.invalid/v1', fetcher);

test('SSE framing preserves split UTF-8, CRLF, multiline data, and ignores comments', async () => {
  const response = streamResponse(': heartbeat\r\n\r\ndata: ε🙂\r\ndata: second line\r\n\r\ndata: done\r\n\r\n', 1);
  const values: string[] = [];
  for await (const event of sseData(response.body!)) values.push(event);
  assert.deepEqual(values, ['ε🙂\nsecond line', 'done']);
});

test('partial JSON handles every escape boundary without leaking JSON or private fields', () => {
  const reply = 'A "quoted" value, C:\\notes\nε🙂\tand a slash /.';
  const json = JSON.stringify({ ...assessment, visibleText: reply });
  let previous = '';
  for (let end = 1; end <= json.length; end++) {
    const parsed = readReplyPrefix(json.slice(0, end));
    assert.ok(reply.startsWith(parsed.text));
    assert.ok(parsed.text.startsWith(previous));
    assert.doesNotMatch(parsed.text, /PRIVATE_INTERPRETATION|sourceIds|visibleText/);
    previous = parsed.text;
  }
  assert.equal(previous, reply);
  const escapedUnicode = '{"judgment":"correct","sourceIds":["native-source"],"nextAction":"advance","challenge":null,"visibleText":"\\uD83D\\uDE42"}';
  for (let end = 1; end <= escapedUnicode.length; end++) {
    const text = readReplyPrefix(escapedUnicode.slice(0, end)).text;
    assert.ok(text === '' || text === '🙂');
  }
});

test('StepFun streams visible text before completion and keeps reasoning and private fields server-side', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const provider = service(async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.stream, true);
    assert.deepEqual(Object.keys(payload.response_format.json_schema.schema.properties).slice(0, 5), ['judgment', 'sourceIds', 'nextAction', 'challenge', 'visibleText']);
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const text: string[] = [], timings: ProviderTiming[] = [];
  let completed = false;
  const pending = runTurn(request(), provider, { onText: part => text.push(part), onMetrics: timing => timings.push(timing) }).then(result => { completed = true; return result; });
  const json = JSON.stringify(assessment);
  const split = json.indexOf(assessment.visibleText) + 'Oh, the rate'.length;
  controller.enqueue(encoder.encode(frame({ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING', reasoning: 'ALSO_PRIVATE' } }] })));
  await nextTick();
  assert.deepEqual(text, []);
  controller.enqueue(encoder.encode(delta(json.slice(0, split))));
  await nextTick();
  assert.equal(completed, false);
  assert.deepEqual(text, ['Oh, the rate']);
  controller.enqueue(encoder.encode(delta(json.slice(split)) + finish()));
  controller.close();
  const result = await pending;
  assert.equal(result.visibleText, assessment.visibleText);
  assert.equal(text.at(-1), assessment.visibleText);
  assert.doesNotMatch(text.join(''), /PRIVATE_|ALSO_PRIVATE|judgment|sourceIds/);
  assert.equal(result.evidence[0].kind, 'explained');
  assert.equal(timings[0].inputTokens, 170);
  assert.equal(timings[0].outputTokens, 45);
  assert.ok(timings[0].firstChunkMs! <= timings[0].firstReplyMs!);
  assert.ok(timings[0].firstReplyMs! <= timings[0].durationMs);
});

test('unverified challenges, unknown sources, and invalid header enums never emit visible chunks', async () => {
  const cases: { value: unknown; expected: string | undefined }[] = [
    { value: { ...assessment, challenge, nextAction: 'challenge', visibleText: challenge.candidate }, expected: undefined },
    { value: { ...assessment, sourceIds: ['another-course'] }, expected: 'INVALID_SOURCE' },
    { value: { ...assessment, nextAction: 'execute-tool' }, expected: 'INVALID_MODEL_OUTPUT' },
    { value: { ...assessment, judgment: 'definitely' }, expected: 'INVALID_MODEL_OUTPUT' },
  ];
  for (const { value, expected } of cases) {
    const emitted: string[] = [];
    const provider = service(async () => streamResponse(delta(JSON.stringify(value)) + finish()));
    const pending = runTurn(request(), provider, { onText: text => emitted.push(text) });
    if (expected) await assert.rejects(pending, error => error instanceof ApiError && error.code === expected);
    else {
      const result = await pending;
      assert.equal(result.pendingChallenge, false);
      assert.ok(!result.visibleText.includes(challenge.candidate));
    }
    assert.deepEqual(emitted, [], JSON.stringify(value));
  }
});

test('ordinary challenge-eligible turns stream while pending corrections remain buffered', async () => {
  for (const hasPending of [false, true]) {
    const state = decodeState(undefined, 'stream-session', [document]);
    state.substantialTurns = 2;
    if (hasPending) state.pending = { ...challenge, conceptId: concept.id, attempts: 0 };
    const emitted: string[] = [];
    const provider = service(async (_input, init) => {
      assert.equal(JSON.parse(String(init?.body)).stream, true, 'Metrics still collect provider streaming time');
      return streamResponse(delta(JSON.stringify({ ...assessment, correctionAccepted: true })) + finish());
    });
    const result = await runTurn(request({ engineState: encodeState(state), settings: { challenges: 'standard' } }), provider, { onText: text => emitted.push(text), onMetrics: () => {} });
    assert.deepEqual(emitted, hasPending ? [] : [assessment.visibleText]);
    if (hasPending) assert.equal(result.resolvedCorrection?.statement, challenge.correction);
    else assert.equal(result.visibleText, assessment.visibleText);
  }
});

test('an actual eligible challenge stays hidden until independent verification completes', async () => {
  const state = decodeState(undefined, 'stream-session', [document]);
  state.substantialTurns = 2;
  const emitted: string[] = [];
  let releaseVerification!: (response: Response) => void;
  let verifying = false, completed = false;
  const provider = service(async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    if (payload.response_format.json_schema.name === 'miso_verification') {
      verifying = true;
      return new Promise<Response>(resolve => { releaseVerification = resolve; });
    }
    return streamResponse(delta(JSON.stringify({ ...assessment, challenge, nextAction: 'challenge', visibleText: challenge.candidate })) + finish());
  });
  const pending = runTurn(request({ engineState: encodeState(state), settings: { challenges: 'standard' } }), provider, { onText: text => emitted.push(text) }).then(result => { completed = true; return result; });
  await nextTick();
  assert.equal(verifying, true);
  assert.equal(completed, false);
  assert.deepEqual(emitted, []);
  releaseVerification(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ verdict: 'approved', reason: 'Only rate changes, as the quoted source explicitly states.', sourceIds: [source.id] }) } }] }), { headers: { 'Content-Type': 'application/json' } }));
  const result = await pending;
  assert.equal(result.pendingChallenge, true);
  assert.equal(result.visibleText, challenge.candidate);
  assert.equal(result.label, 'Check my understanding');
  assert.deepEqual(emitted, []);
});

test('aborting a stalled SSE read promptly cancels the reader', async () => {
  const abort = new AbortController();
  let cancelled = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancelled = true; } });
  const read = (async () => { for await (const _event of sseData(body, abort.signal)) { /* No data should arrive. */ } })();
  const outcome = read.then(() => 'completed', error => error instanceof DOMException ? error.name : 'other-error');
  await nextTick();
  abort.abort();
  const settled = await Promise.race([outcome, delay(100, 'stalled')]);
  if (settled === 'stalled') controller.close(); // Release a broken implementation before asserting.
  await outcome;
  assert.equal(settled, 'AbortError');
  assert.equal(cancelled, true);
});

test('malformed SSE data is rejected as model output rather than a network outage', async () => {
  const emitted: string[] = [];
  const provider = service(async () => streamResponse('data: {invalid-private-frame}\n\n'));
  await assert.rejects(runTurn(request(), provider, { onText: text => emitted.push(text) }), error => error instanceof ApiError && error.code === 'INVALID_MODEL_OUTPUT' && !error.message.includes('invalid-private-frame'));
  assert.deepEqual(emitted, []);
});

test('collection cache is session-scoped with sliding expiry, replacement, deletion, and bounded eviction', t => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const cache = new CollectionCache(100, 2);
  const first = cache.put('session-a', [document]);
  const expired = (id: string, session: string) => assert.throws(() => cache.get(id, session), error => error instanceof ApiError && error.code === 'COLLECTION_EXPIRED');
  expired(first, 'session-b');
  now += 80;
  assert.deepEqual(cache.get(first, 'session-a'), [document]);
  now += 80;
  assert.deepEqual(cache.get(first, 'session-a'), [document]);
  now += 101;
  expired(first, 'session-a');
  const replacement = cache.put('session-a', [document]);
  const replaced = cache.put('session-a', [document]);
  expired(replacement, 'session-a');
  cache.put('session-b', [document]);
  const third = cache.put('session-c', [document]);
  expired(replaced, 'session-a');
  assert.deepEqual(cache.get(third, 'session-c'), [document]);
  cache.remove('session-c');
  expired(third, 'session-c');
});
