import { ApiError } from './schema.js';
import { prepareSpeechText } from './audio-text.js';

type Environment = Record<string, string | undefined>;
const MAX_SPEECH_CHARACTERS = 4096;
const MAX_WAV_BYTES = 32 * 1024 * 1024;
const MAX_RECORDING_BYTES = 12 * 1024 * 1024;
export const DEFAULT_ASR_MODEL = 'stepaudio-3-asr-max';
export const DEFAULT_TTS_MODEL = 'stepaudio-3-tts';
export const DEFAULT_TTS_VOICE = 'vibrant-youth';
export const VOICE_INSTRUCTION = 'Speak like a friendly, slightly confused college study buddy. Sound curious and expressive, with natural pauses and small moments of realization. Keep the delivery conversational, never babyish.';

export function voiceConfiguration(env: Environment = process.env) {
  const selected = (env.VOICE_PROVIDER || 'stepfun').trim().toLowerCase();
  const provider: 'StepFun' | 'Off' = selected === 'stepfun' ? 'StepFun' : 'Off';
  const keyName = provider === 'StepFun' ? 'STEPFUN_API_KEY' as const : null;
  return { provider, keyName, available: Boolean(keyName && env[keyName]?.trim()) };
}

/** StepFun accepts at most 1000 characters. Preserve all text and sentence order. */
export function splitSpeech(text: string, limit = 1000): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('Invalid speech chunk size');
  let remaining = text.trim();
  const chunks: string[] = [];
  while (remaining.length > limit) {
    const prefix = remaining.slice(0, limit);
    const sentence = [...prefix.matchAll(/[.!?](?:["'”’])?\s+/g)].at(-1);
    const space = [...prefix.matchAll(/\s+/g)].at(-1);
    let end = sentence && sentence.index + sentence[0].length >= limit / 2
      ? sentence.index + sentence[0].length
      : space && space.index >= limit / 2 ? space.index + space[0].length : limit;
    if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
function audioError(): ApiError {
  return new ApiError(502, 'StepFun returned an unsupported audio file. You can read the full response or retry playback.', 'VOICE_INVALID_AUDIO');
}

/** Join PCM samples, not complete WAV files: each provider result has its own RIFF header. */
export function combineWav(parts: Buffer[]): Buffer {
  if (!parts.length || parts.reduce((size, part) => size + part.length, 0) > MAX_WAV_BYTES) throw audioError();
  let format: Buffer | undefined;
  const samples: Buffer[] = [];
  for (const part of parts) {
    if (part.length < 44 || part.toString('ascii', 0, 4) !== 'RIFF' || part.toString('ascii', 8, 12) !== 'WAVE') throw audioError();
    const end = part.readUInt32LE(4) + 8;
    if (end !== part.length) throw audioError();
    let currentFormat: Buffer | undefined;
    const currentSamples: Buffer[] = [];
    let offset = 12;
    while (offset < end) {
      if (offset + 8 > end) throw audioError();
      const name = part.toString('ascii', offset, offset + 4);
      const size = part.readUInt32LE(offset + 4);
      const start = offset + 8;
      const next = start + size + (size % 2);
      if (next > end) throw audioError();
      if (name === 'fmt ') {
        if (size < 16 || currentFormat) throw audioError();
        currentFormat = part.subarray(start, start + 16);
      } else if (name === 'data') currentSamples.push(part.subarray(start, start + size));
      offset = next;
    }
    if (!currentFormat || !currentSamples.length) throw audioError();
    const channels = currentFormat.readUInt16LE(2);
    const rate = currentFormat.readUInt32LE(4);
    const byteRate = currentFormat.readUInt32LE(8);
    const alignment = currentFormat.readUInt16LE(12);
    const bits = currentFormat.readUInt16LE(14);
    if (currentFormat.readUInt16LE(0) !== 1 || channels < 1 || channels > 2 || rate < 8000 || rate > 192000
      || ![8, 16, 24, 32].includes(bits) || alignment !== channels * bits / 8 || byteRate !== rate * alignment
      || currentSamples.some(sample => !sample.length || sample.length % alignment !== 0)) throw audioError();
    if (format && !format.equals(currentFormat)) throw audioError();
    format = currentFormat;
    samples.push(...currentSamples);
  }
  const data = Buffer.concat(samples);
  const pad = data.length % 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length + pad, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  format!.copy(header, 20);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data, Buffer.alloc(pad)]);
}

/** Match container bytes to the declared format. Never relabel WebM as WAV. */
export function recordingFormat(buffer: Buffer, mime: string): 'wav' | 'ogg' | 'mp3' | 'm4a' {
  if (!buffer.length || buffer.length > MAX_RECORDING_BYTES) throw new ApiError(413, 'Recordings must be nonempty and under 12 MB. Try a shorter explanation.', 'AUDIO_TOO_LARGE');
  const type = mime.toLowerCase().split(';')[0];
  if (['audio/wav', 'audio/x-wav'].includes(type) && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') {
    let normalized: Buffer;
    try { normalized = combineWav([buffer]); }
    catch { throw new ApiError(415, 'This WAV recording is malformed or uses unsupported encoding. Record again or continue typing.', 'VOICE_RECORDING_FORMAT'); }
    const duration = normalized.readUInt32LE(40) / normalized.readUInt32LE(28);
    if (duration > 181) throw new ApiError(413, 'Record up to 3 minutes at a time, then review the transcript before sending.', 'AUDIO_TOO_LONG');
    return 'wav';
  }
  if (type === 'audio/ogg' && buffer.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (type === 'audio/mpeg' && (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))) return 'mp3';
  if (['audio/mp4', 'video/mp4', 'audio/x-m4a'].includes(type) && buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  throw new ApiError(415, 'StepFun needs WAV, OGG, MP3, or M4A audio. This recording format is unsupported; try recording again or continue typing.', 'VOICE_RECORDING_FORMAT');
}

function safeVoiceError(error: unknown, signal?: AbortSignal): ApiError {
  if (error instanceof ApiError) return error;
  const details = error && typeof error === 'object' ? error as { status?: number; name?: string } : {};
  if (signal?.aborted && signal.reason?.name !== 'TimeoutError') return new ApiError(499, 'Voice request canceled. You can continue typing.', 'VOICE_CANCELED');
  if (details.name === 'TimeoutError' || details.name === 'AbortError' || signal?.aborted || [408, 504].includes(details.status ?? 0)) {
    return new ApiError(504, 'StepFun voice did not respond in time. Try again or continue typing.', 'VOICE_TIMEOUT');
  }
  if (details.status === 429) return new ApiError(429, 'StepFun voice reached an account or rate limit. Try again later; you can continue typing.', 'VOICE_LIMIT');
  if (details.status === 402) return new ApiError(402, 'StepFun voice needs API credit or audio access on this account. You can continue typing.', 'VOICE_BILLING');
  if ([400, 401, 403, 404, 422].includes(details.status ?? 0)) return new ApiError(502, 'StepFun rejected this audio request. Check the API key, audio model access, STEPFUN_AUDIO_BASE_URL and selected voice on the server. You can continue typing.', 'VOICE_CONFIGURATION');
  return new ApiError(502, 'StepFun voice could not finish this request. Check the connection or retry; typed chat is still available.', 'VOICE_ERROR');
}

/** ASR is its own JSON/SSE API; it is not OpenAI's multipart transcription endpoint. */
async function readTranscript(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) throw new ApiError(502, 'StepFun returned an unreadable transcript. Try recording again or continue typing.', 'VOICE_INVALID_TRANSCRIPT');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let byteCount = 0;
  let completed: string | undefined;
  function consume(frame: string) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let event: { type?: string; text?: unknown; delta?: unknown };
    try { event = JSON.parse(data); } catch { throw new ApiError(502, 'StepFun returned an incomplete transcript. Try again or continue typing.', 'VOICE_INVALID_TRANSCRIPT'); }
    if (event.type === 'error') throw new ApiError(502, 'StepFun could not recognize this recording. Try a shorter recording or continue typing.', 'VOICE_ASR_ERROR');
    // The final text may correct earlier deltas, so never evaluate an incremental fragment.
    if (event.type === 'transcript.text.done' && typeof event.text === 'string') completed = event.text.trim();
  }
  try {
    while (completed === undefined) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      byteCount += value?.length ?? 0;
      if (byteCount > 2 * 1024 * 1024) throw new ApiError(502, 'StepFun returned an oversized transcript. Record a shorter explanation.', 'VOICE_INVALID_TRANSCRIPT');
      pending += decoder.decode(value, { stream: !done });
      pending = pending.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = pending.indexOf('\n\n')) !== -1) { consume(pending.slice(0, end)); pending = pending.slice(end + 2); }
      if (done) { if (pending.trim()) consume(pending); break; }
    }
    signal.throwIfAborted();
    if (completed === undefined) throw new ApiError(502, 'The transcription connection ended early. Your explanation was not sent; record again or type it.', 'VOICE_INVALID_TRANSCRIPT');
    if (!completed) throw new ApiError(422, 'No clear speech was found. Try again or type your explanation.', 'VOICE_EMPTY_TRANSCRIPT');
    if (completed.length > 16_000) throw new ApiError(502, 'This transcript is too long. Try a shorter recording.', 'VOICE_INVALID_TRANSCRIPT');
    return completed;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function readAudio(response: Response, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) throw audioError();
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_WAV_BYTES) throw audioError();
      chunks.push(Buffer.from(value));
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Injectable transport verifies the actual provider wire format without requiring account access. */
export function createVoiceService(env: Environment = process.env, fetcher: typeof fetch = fetch) {
  const configuration = voiceConfiguration(env);
  function key() {
    if (!configuration.keyName) throw new ApiError(503, 'Voice is disabled. The complete study session is available by typing.', 'VOICE_NOT_CONFIGURED');
    const value = env[configuration.keyName]?.trim();
    if (!value) throw new ApiError(503, 'Voice needs STEPFUN_API_KEY on the server. You can complete the session by typing.', 'VOICE_NOT_CONFIGURED');
    return value;
  }
  const baseUrl = (env.STEPFUN_AUDIO_BASE_URL || env.STEPFUN_BASE_URL || 'https://api.stepfun.ai/v1').replace(/\/+$/, '');
  async function request(path: string, body: unknown, signal: AbortSignal, sse = false) {
    signal.throwIfAborted();
    const response = await fetcher(`${baseUrl}/audio/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', Accept: sse ? 'text/event-stream' : 'audio/wav' },
      body: JSON.stringify(body), signal,
    });
    if (!response.ok) { await response.body?.cancel(); throw { status: response.status }; }
    return response;
  }
  const requestSignal = (signal: AbortSignal | undefined, timeout: number) => signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  return {
    async transcribe(buffer: Buffer, mime: string, _extension: string, signal?: AbortSignal): Promise<string> {
      const active = requestSignal(signal, 60_000);
      try {
        key();
        const format = recordingFormat(buffer, mime);
        const response = await request('asr/sse', { audio: {
          data: buffer.toString('base64'), input: {
            transcription: { model: env.STEPFUN_TRANSCRIBE_MODEL || DEFAULT_ASR_MODEL, language: env.STEPFUN_AUDIO_LANGUAGE || 'en', enable_itn: true },
            format: { type: format },
          },
        } }, active, true);
        return await readTranscript(response, active);
      } catch (error) { throw safeVoiceError(error, active); }
    },
    async synthesize(text: string, signal?: AbortSignal): Promise<{ buffer: Buffer; contentType: string }> {
      if (!text.trim() || text.length > MAX_SPEECH_CHARACTERS) throw new ApiError(400, 'Choose a response between 1 and 4096 characters to read aloud.', 'VOICE_INVALID_TEXT');
      const active = requestSignal(signal, 120_000);
      try {
        key();
        const parts: Buffer[] = [];
        let bytes = 0;
        for (const input of splitSpeech(prepareSpeechText(text))) {
          const response = await request('speech', {
            model: env.STEPFUN_TTS_MODEL || DEFAULT_TTS_MODEL, input,
            voice: env.STEPFUN_TTS_VOICE || DEFAULT_TTS_VOICE, language: env.STEPFUN_AUDIO_LANGUAGE || 'en',
            response_format: 'wav', sample_rate: 24000, speed: 1, volume: 1,
            // Omit stream_format: explicitly setting it enables a streaming mode
            // which this account rejects for WAV, despite WAV being a valid file format.
            instruction: VOICE_INSTRUCTION,
          }, active);
          const part = await readAudio(response, active);
          bytes += part.length;
          if (bytes > MAX_WAV_BYTES) throw audioError();
          parts.push(part);
        }
        return { buffer: combineWav(parts), contentType: 'audio/wav' };
      } catch (error) { throw safeVoiceError(error, active); }
    },
  };
}

export const transcribe = (buffer: Buffer, mime: string, extension: string, signal?: AbortSignal) => createVoiceService().transcribe(buffer, mime, extension, signal);
export const synthesize = (text: string, signal?: AbortSignal) => createVoiceService().synthesize(text, signal);

