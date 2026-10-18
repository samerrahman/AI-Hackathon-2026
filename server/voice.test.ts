import test from 'node:test';
import assert from 'node:assert/strict';
import { combineWav, createVoiceService, splitSpeech, voiceConfiguration } from './voice.js';
import { prepareSpeechText } from './audio-text.js';
import { ApiError } from './schema.js';

function wav(samples: number[], rate = 24000, metadata = false) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length + (metadata ? 10 : 0), 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const extra = Buffer.from([74, 85, 78, 75, 1, 0, 0, 0, 9, 0]); // JUNK with odd-byte padding.
  return Buffer.concat([header, data, ...(metadata ? [extra] : [])]);
}
const responseAudio = () => new Response(new Uint8Array(wav([1, 2])), { headers: { 'Content-Type': 'audio/wav' } });
function failure(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /private-diagnostic|test-key/);
    return true;
  };
}

const env = { STEPFUN_API_KEY: 'test-key' };
function sse(events: unknown[], split = false) {
  const text = events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    if (split) for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('StepFun is the only audio provider; explicit off and missing key preserve typed chat', async () => {
  assert.deepEqual(voiceConfiguration(env), { provider: 'StepFun', keyName: 'STEPFUN_API_KEY', available: true });
  assert.equal(voiceConfiguration({ OPENAI_API_KEY: 'unused', GROQ_API_KEY: 'unused' }).available, false);
  assert.deepEqual(voiceConfiguration({ ...env, VOICE_PROVIDER: 'off' }), { provider: 'Off', keyName: null, available: false });
  let calls = 0;
  const off = createVoiceService({ ...env, VOICE_PROVIDER: 'off' }, async () => { calls++; return responseAudio(); });
  await assert.rejects(off.transcribe(wav([1]), 'audio/wav', 'wav'), failure('VOICE_NOT_CONFIGURED'));
  await assert.rejects(off.synthesize('Hello'), failure('VOICE_NOT_CONFIGURED'));
  await assert.rejects(createVoiceService({}).synthesize('Hello'), failure('VOICE_NOT_CONFIGURED'));
  assert.equal(calls, 0);
});

test('ASR sends documented JSON/base64, honors plan URL, and uses final corrected SSE text', async () => {
  let calls = 0;
  const recording = wav([1, 2]);
  const service = createVoiceService({ ...env, STEPFUN_AUDIO_BASE_URL: 'https://api.stepfun.ai/step_plan/v1/' }, async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://api.stepfun.ai/step_plan/v1/audio/asr/sse');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-key');
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('Accept'), 'text/event-stream');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.audio.data, recording.toString('base64'));
    assert.deepEqual(body.audio.input, { transcription: { model: 'stepaudio-3-asr-max', language: 'en', enable_itn: true }, format: { type: 'wav' } });
    return sse([{ type: 'transcript.text.delta', delta: 'n is fixed' }, { type: 'transcript.text.done', text: 'Capital N depends on ε.' }], true);
  });
  assert.equal(await service.transcribe(recording, 'audio/wav', 'wav'), 'Capital N depends on ε.');
  assert.equal(calls, 1);
});

test('unsupported and falsely labeled audio never reaches StepFun; incomplete transcripts never become answers', async () => {
  let calls = 0;
  const service = createVoiceService(env, async () => { calls++; return sse([{ type: 'transcript.text.done', text: 'Hello' }]); });
  await assert.rejects(service.transcribe(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'audio/webm', 'webm'), failure('VOICE_RECORDING_FORMAT'));
  await assert.rejects(service.transcribe(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'audio/wav', 'wav'), failure('VOICE_RECORDING_FORMAT'));
  assert.equal(calls, 0);
  for (const [events, code] of [
    [[{ type: 'transcript.text.delta', delta: 'A partial claim' }], 'VOICE_INVALID_TRANSCRIPT'],
    [[{ type: 'transcript.text.done', text: ' ' }], 'VOICE_EMPTY_TRANSCRIPT'],
    [[{ type: 'error', message: 'private-diagnostic' }], 'VOICE_ASR_ERROR'],
  ] as const) {
    const broken = createVoiceService(env, async () => sse([...events]));
    await assert.rejects(broken.transcribe(wav([1]), 'audio/wav', 'wav'), failure(code));
  }
});

test('spoken math preserves grouping, quantifiers, case, negation and explanatory parentheses', () => {
  const input = String.raw`For every $\epsilon > 0$, choose N (depending on ε), so $|a_n - L| < \epsilon$. It does not say one N works for all ε. $\frac{n+1}{n}$ and $(x+1)^2$.`;
  const output = prepareSpeechText(input);
  assert.doesNotMatch(output, /[()$\\]/);
  assert.match(output, /epsilon greater than 0/);
  assert.match(output, /capital N open parenthesis depending on epsilon close parenthesis/);
  assert.match(output, /does not say one capital N works for all epsilon/);
  assert.match(output, /fraction, numerator n plus 1, denominator n, end fraction/);
  assert.match(output, /open parenthesis x plus 1 close parenthesis/);
  assert.match(output, /close parenthesis to the power of 2/);
  assert.match(output, /a subscript n minus L/);
  assert.equal(prepareSpeechText('This (quietly) is still part of the reply.'), 'This open parenthesis quietly close parenthesis is still part of the reply.');
});

test('speech stays within StepFun input limit, preserves text and uses persona only in instruction', async () => {
  const text = 'That condition finally makes sense (I had skipped it). '.repeat(25);
  const spoken = prepareSpeechText(text);
  const inputs: string[] = [];
  const service = createVoiceService(env, async (input, init) => {
    assert.equal(String(input), 'https://api.stepfun.ai/v1/audio/speech');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'stepaudio-3-tts');
    assert.equal(body.voice, 'vibrant-youth');
    assert.equal(body.response_format, 'wav');
    assert.equal(body.sample_rate, 24000);
    assert.equal(body.stream_format, undefined); // Live API rejects explicit stream mode with WAV.
    assert.match(body.instruction, /college study buddy/);
    assert.ok(body.input.length <= 1000);
    assert.doesNotMatch(body.input, /[()]/);
    inputs.push(body.input);
    return responseAudio();
  });
  const output = await service.synthesize(text);
  assert.equal(inputs.join(''), spoken);
  assert.equal(output.contentType, 'audio/wav');
  assert.equal(output.buffer.readUInt32LE(40), inputs.length * 4);
  for (const value of ['🔬'.repeat(900), 'x'.repeat(2005), 'A sentence. '.repeat(250)]) {
    const parts = splitSpeech(value);
    assert.equal(parts.join(''), value.trim());
    assert.ok(parts.every(part => part.length <= 1000 && !/[\uD800-\uDBFF]$/.test(part)));
  }
});

test('WAV assembly validates format and preserves samples, rejecting malformed or mismatched audio', () => {
  const output = combineWav([wav([10, 20], 24000, true), wav([-30, 40])]);
  assert.equal(output.readUInt32LE(4), output.length - 8);
  assert.equal(output.readUInt32LE(40), 8);
  assert.deepEqual([...Array(4)].map((_, index) => output.readInt16LE(44 + index * 2)), [10, 20, -30, 40]);
  assert.throws(() => combineWav([wav([1]), wav([2], 16000)]), failure('VOICE_INVALID_AUDIO'));
  assert.throws(() => combineWav([wav([1]).subarray(0, 42)]), failure('VOICE_INVALID_AUDIO'));
});

test('audio account failures are safe and cancellation prevents subsequent synthesis calls', async () => {
  for (const [status, code] of [[403, 'VOICE_CONFIGURATION'], [402, 'VOICE_BILLING'], [429, 'VOICE_LIMIT'], [504, 'VOICE_TIMEOUT']] as const) {
    const service = createVoiceService(env, async () => new Response(JSON.stringify({ error: 'private-diagnostic' }), { status }));
    await assert.rejects(service.synthesize('Hello'), failure(code));
  }
  const controller = new AbortController();
  let calls = 0;
  const service = createVoiceService(env, async () => { calls++; controller.abort(); return responseAudio(); });
  await assert.rejects(service.synthesize('A long explanation. '.repeat(100), controller.signal), failure('VOICE_CANCELED'));
  assert.equal(calls, 1);
  const timeout = new AbortController();
  timeout.abort(new DOMException('private-diagnostic', 'TimeoutError'));
  await assert.rejects(createVoiceService(env).synthesize('Hello', timeout.signal), failure('VOICE_TIMEOUT'));
});

