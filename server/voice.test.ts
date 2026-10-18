import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from './index.js';

test('voice requests use StepFun with server credentials and documented audio formats', async () => {
  const previous = process.env.STEPFUN_API_KEY;
  process.env.STEPFUN_API_KEY = 'test-only-key';
  const realFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/audio/speech')) return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    return Response.json({ text: 'The explanation was clear.' });
  };
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const config = await realFetch(`${base}/api/config`).then(response => response.json());
    assert.equal(config.voiceAvailable, true);

    const speech = await realFetch(`${base}/api/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello, teacher.' }) });
    assert.equal(speech.status, 200);
    assert.equal(speech.headers.get('content-type'), 'audio/mpeg');
    assert.equal(calls[0].url, 'https://api.stepfun.ai/v1/audio/speech');
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer test-only-key');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { model: 'stepaudio-3-tts', input: 'Hello, teacher.', voice: 'zixinnansheng', response_format: 'mp3', instruction: 'Speak in English like a calm college classmate: clear, warm, measured, and respectful. Read mathematical notation naturally.' });

    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }), 'recording.wav');
    const transcript = await realFetch(`${base}/api/transcribe`, { method: 'POST', body: form });
    assert.equal(transcript.status, 200);
    assert.deepEqual(await transcript.json(), { text: 'The explanation was clear.' });
    assert.equal(calls[1].url, 'https://api.stepfun.ai/v1/audio/transcriptions');
    assert.equal((calls[1].init?.headers as Record<string, string>).Authorization, 'Bearer test-only-key');
    assert.equal((calls[1].init?.body as FormData).get('model'), 'stepaudio-2.5-asr');
  } finally {
    globalThis.fetch = realFetch;
    if (previous === undefined) delete process.env.STEPFUN_API_KEY;
    else process.env.STEPFUN_API_KEY = previous;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
