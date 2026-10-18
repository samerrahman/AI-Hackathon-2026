import test from 'node:test';
import assert from 'node:assert/strict';
import type { SourceSpan } from '../shared/types.js';
import { GeminiProvider } from './provider.js';
import { ApiError } from './schema.js';

const source: SourceSpan = { id: 'source-1', documentId: 'document-1', pageIndex: 0, text: 'A catalyst changes the reaction rate without changing the equilibrium constant.', quality: 'native' };
const outline = { concepts: [{ title: 'Catalysts and equilibrium', description: 'Rate and equilibrium are different properties.', question: 'What changes when a catalyst is added?', sourceIds: [source.id] }] };
const modelResponse = (value: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }));
function expectedError(code: string, status: number, context: 'notes' | 'draft' = 'notes') {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.match(error.message, context === 'notes' ? /Your notes are still here/ : /Your draft is safe/);
    assert.doesNotMatch(error.message, /private-diagnostic|test-key/);
    return true;
  };
}

test('concept generation uses the supported default model and preserves structured source data', async t => {
  const previousModel = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL;
  t.after(() => { if (previousModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = previousModel; });
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
    assert.ok(!('temperature' in body.generationConfig), 'Gemini 3.8 rejects the removed sampling controls');
    assert.ok(!('responseMimeType' in body.generationConfig));
    assert.ok(!('responseJsonSchema' in body.generationConfig));
    const schema = body.generationConfig.responseFormat.text.schema;
    assert.ok(schema.properties.concepts);
    assert.deepEqual(schema.properties.concepts.items.required, ['title', 'description', 'question', 'sourceIds']);
    assert.equal(schema.properties.concepts.items.properties.title.type, 'string');
    assert.doesNotMatch(JSON.stringify(schema), /"(?:minLength|maxLength|minItems|maxItems|additionalProperties)":/);
    assert.match(body.systemInstruction.parts[0].text, /UNTRUSTED STUDY DATA/);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).sources[0], { id: source.id, documentId: source.documentId, pageIndex: source.pageIndex, text: source.text, quality: source.quality });
    assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], 'test-key');
    assert.ok(init?.signal instanceof AbortSignal);
    return modelResponse(outline);
  });
  assert.deepEqual(await new GeminiProvider('test-key').concepts([source]), outline);
});

test('actual request timeouts receive timeout guidance for preparing notes', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('private-diagnostic', 'TimeoutError'); });
  await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('PROVIDER_TIMEOUT', 504));
});

test('DNS and TLS failures are network errors, not falsely reported as timeouts', async t => {
  let code = 'ENOTFOUND';
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('private-diagnostic', { cause: { code } }); });
  for (code of ['ENOTFOUND', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ECONNRESET']) {
    await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('PROVIDER_NETWORK', 502));
  }
});

test('transport failures and timeouts while reading the body retain their real classification', async t => {
  let failure: Error = new TypeError('private-diagnostic', { cause: { code: 'ECONNRESET' } });
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { controller.error(failure); } })));
  await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('PROVIDER_NETWORK', 502));
  failure = new DOMException('private-diagnostic', 'TimeoutError');
  await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('PROVIDER_TIMEOUT', 504));
  failure = new TypeError('private-diagnostic', { cause: { code: 'UND_ERR_BODY_TIMEOUT' } });
  await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('PROVIDER_TIMEOUT', 504));
});

test('unavailable models have distinct actionable configuration guidance', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private-diagnostic', { status: 404 }));
  await assert.rejects(new GeminiProvider('test-key', 'retired-model').concepts([source]), error => {
    expectedError('PROVIDER_MODEL_UNAVAILABLE', 502)(error);
    assert.match((error as ApiError).message, /Update GEMINI_MODEL/);
    assert.match((error as ApiError).message, /restart the server/);
    return true;
  });
});

test('provider quota, access, and server failures remain distinct', async t => {
  let status = 429;
  t.mock.method(globalThis, 'fetch', async () => new Response('private-diagnostic', { status }));
  await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('PROVIDER_LIMIT', 429));
  for (status of [400, 401, 403]) {
    await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('PROVIDER_CONFIGURATION', 502));
  }
  status = 503;
  await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('PROVIDER_ERROR', 502));
});

test('malformed outer JSON, model JSON, and invalid contracts are rejected without leaking content', async t => {
  let response = () => new Response('private-diagnostic');
  t.mock.method(globalThis, 'fetch', async () => response());
  await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('INVALID_MODEL_OUTPUT', 502));
  response = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'private-diagnostic' }] } }] }));
  await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('INVALID_MODEL_OUTPUT', 502));
  response = () => modelResponse({ concepts: [{ title: 'Invalid', sourceIds: [] }] });
  await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('INVALID_MODEL_OUTPUT', 502));
});

test('conversation verification failures preserve draft wording instead of upload wording', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('private-diagnostic', 'TimeoutError'); });
  const challenge = { candidate: 'A catalyst changes the equilibrium constant.', correction: source.text, distinction: 'Reaction rate changes, but the equilibrium constant does not.', sourceIds: [source.id], quote: source.text, hint: 'Which property is unchanged?' };
  await assert.rejects(new GeminiProvider('test-key').verify(challenge, [source]), expectedError('PROVIDER_TIMEOUT', 504, 'draft'));
});

test('local validation still enforces bounds omitted from the provider wire schema', async t => {
  let value: unknown = { concepts: [] };
  t.mock.method(globalThis, 'fetch', async () => modelResponse(value));
  const concept = outline.concepts[0];
  for (value of [
    { concepts: [] },
    { concepts: Array.from({ length: 11 }, () => concept) },
    { concepts: [{ ...concept, title: '' }] },
    { concepts: [{ ...concept, description: 'x'.repeat(1501) }] },
    { concepts: [{ ...concept, sourceIds: [] }] },
    { concepts: [{ ...concept, sourceIds: Array.from({ length: 41 }, () => source.id) }] },
  ]) {
    await assert.rejects(new GeminiProvider('test-key').concepts([source]), expectedError('INVALID_MODEL_OUTPUT', 502));
  }
});
