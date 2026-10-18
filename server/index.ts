import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ApiError, LIMITS, conceptRequestSchema, turnRequestSchema } from './schema.js';
import { createConcepts, RevisionGate, runTurn } from './engine.js';
import { DemoProvider } from './demo.js';
import { StepFunProvider } from './provider.js';
import { createTopicSchema, teachTurnSchema } from './teach-schema.js';
import { createTeachTopic, openTeachState, runTeachTurn } from './teach-engine.js';
import { StepFunTeachProvider } from './teach-provider.js';
import { DemoTeachProvider } from './teach-demo.js';

export const app = express();
app.disable('x-powered-by');
if (process.env.FUNCTION_TARGET) app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.get('origin');
  if (origin) {
    try {
      const url = new URL(origin);
      const host = req.get('x-forwarded-host')?.split(',')[0]?.trim().split(':')[0] || req.hostname;
      if (url.hostname !== host && !(['localhost', '127.0.0.1'].includes(url.hostname) && ['localhost', '127.0.0.1'].includes(host))) throw new Error();
    } catch { return res.status(403).json({ error: 'This request must come from the Miso application.' }); }
  }
  next();
});
// Bound public, paid model calls even when a browser does not send Origin.
const windows = new Map<string, { starts: number; count: number }>();
app.use(['/api/topic', '/api/teach', '/api/concepts', '/api/turn', '/api/transcribe', '/api/speech'], (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (windows.size > 10000) for (const [key, value] of windows) if (now - value.starts >= 600000) windows.delete(key);
  const window = windows.get(ip);
  const entry = !window || now - window.starts >= 600000 ? { starts: now, count: 0 } : window;
  windows.set(ip, entry);
  if (++entry.count > 30) { res.setHeader('Retry-After', String(Math.ceil((entry.starts + 600000 - now) / 1000))); return res.status(429).json({ error: 'Too many study requests. Please try again in a few minutes.', code: 'RATE_LIMIT' }); }
  next();
});
const gate = new RevisionGate();
const provider = (mode: 'live' | 'demo', sampleId?: 'analysis' | 'research') => {
  if (mode === 'demo') {
    if (!sampleId) throw new ApiError(400, 'Choose a bundled sample to start a sample demo.', 'DEMO_ONLY');
    return new DemoProvider(sampleId);
  }
  return new StepFunProvider();
};
app.get('/api/config', (_req, res) => res.json({ liveAvailable: Boolean(process.env.STEPFUN_API_KEY?.trim()), voiceAvailable: Boolean(process.env.STEPFUN_API_KEY?.trim()), judgeDebugAvailable: process.env.ENABLE_JUDGE_DEBUG === 'true', provider: 'Step 5 Preview', limits: LIMITS }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/topic', async (req, res) => {
  const request = createTopicSchema.parse(req.body);
  const teachProvider = request.mode === 'demo' ? new DemoTeachProvider(request.sampleId ?? 'analysis') : new StepFunTeachProvider();
  res.json(await createTeachTopic(request, teachProvider));
});
app.post('/api/teach', async (req, res) => {
  const request = teachTurnSchema.parse(req.body);
  const state = openTeachState(request.stateToken, request.topicId, request.documents);
  gate.begin({ sessionId: request.topicId, turnId: request.turnId, revision: request.revision });
  const teachProvider = state.sample ? new DemoTeachProvider(state.sampleId ?? 'analysis') : new StepFunTeachProvider();
  const result = await runTeachTurn(request, teachProvider, process.env.ENABLE_JUDGE_DEBUG === 'true');
  gate.assertCurrent({ sessionId: request.topicId, turnId: request.turnId, revision: request.revision });
  if (!res.destroyed) res.json(result);
});
app.post('/api/concepts', async (req, res) => {
  const request = conceptRequestSchema.parse(req.body);
  const studyProvider = provider(request.mode, request.sampleId);
  const result = await createConcepts(request, studyProvider);
  res.json({ ...result, liveResponse: studyProvider instanceof StepFunProvider && studyProvider.successfulResponses > 0 });
});
app.post('/api/turn', async (req, res) => {
  const request = turnRequestSchema.parse(req.body);
  gate.begin(request);
  const studyProvider = provider(request.mode, request.sampleId);
  const result = await runTurn(request, studyProvider);
  gate.assertCurrent(request);
  if (!res.destroyed) res.json({ ...result, liveResponse: studyProvider instanceof StepFunProvider && studyProvider.successfulResponses > 0 && result.liveResponse === true });
});
// The server stores no uploaded files or conversations; clear only its transient revision guard.
app.delete('/api/session/:id', (req, res) => { gate.remove(req.params.id); res.status(204).end(); });

const audioTypes: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => {
  if (!audioTypes[file.mimetype.split(';')[0]]) callback(new ApiError(415, 'This recording format is not supported. Try recording again or type your explanation.'));
  else callback(null, true);
} });
async function voiceFetch(path: string, init: RequestInit) {
  const key = process.env.STEPFUN_API_KEY;
  if (!key) throw new ApiError(503, 'Voice is not configured on the server. You can complete the session by typing.', 'VOICE_NOT_CONFIGURED');
  let response: Response;
  try { response = await fetch(`${process.env.STEPFUN_BASE_URL || 'https://api.stepfun.ai/v1'}/audio/${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(45_000) }); }
  catch { throw new ApiError(504, 'The voice service did not respond in time. Try again or continue typing.', 'VOICE_TIMEOUT'); }
  if (!response.ok) throw new ApiError(502, 'StepFun could not complete this voice request. Please retry or continue typing.', 'VOICE_ERROR');
  return response;
}
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file?.buffer.length) throw new ApiError(400, 'No recording was received. Try again or type your explanation.');
  const mime = req.file.mimetype.split(';')[0];
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(req.file.buffer)], { type: mime }), `recording.${audioTypes[mime]}`);
  form.append('model', process.env.STEPFUN_ASR_MODEL || 'stepaudio-2.5-asr');
  form.append('response_format', 'json');
  const response = await voiceFetch('transcriptions', { method: 'POST', body: form });
  const data = await response.json() as { text?: string };
  if (!data.text?.trim()) throw new ApiError(422, 'No clear speech was found in that recording. Try again or type your explanation.');
  res.json({ text: data.text });
});
app.post('/api/speech', async (req, res) => {
  const { text } = z.object({ text: z.string().min(1).max(1000) }).parse(req.body);
  const response = await voiceFetch('speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.STEPFUN_TTS_MODEL || 'stepaudio-3-tts', input: text, voice: process.env.STEPFUN_TTS_VOICE || 'zixinnansheng', response_format: 'mp3', instruction: 'Speak in English like a calm college classmate: clear, warm, measured, and respectful. Read mathematical notation naturally.' }),
  });
  res.type('audio/mpeg').send(Buffer.from(await response.arrayBuffer()));
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'That Miso action was not found.' }));
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ApiError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
  if (error instanceof z.ZodError) { res.status(400).json({ error: 'This request contains missing or invalid study data. Your draft is safe; reopen the notes and try again.', code: 'INVALID_REQUEST' }); return; }
  if (error instanceof multer.MulterError) { res.status(413).json({ error: 'Recordings must be under 12 MB. Try a shorter explanation or type it instead.', code: 'AUDIO_TOO_LARGE' }); return; }
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') { res.status(413).json({ error: 'This collection is too large to process at once. Try fewer pages.' }); return; }
  // Never log uploaded lecture text, provider response bodies, credentials, or recordings.
  console.error('Miso request failed:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({ error: 'Miso could not finish this action. Your draft is safe; please retry.', code: 'SERVER_ERROR' });
};
app.use(errors);
