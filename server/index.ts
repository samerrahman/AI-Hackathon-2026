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
import { createTopicSchema, judgeTurnSchema, teachTurnSchema } from './teach-schema.js';
import { createTeachTopic, openTeachState, runJudgeTurn, runTeachTurn } from './teach-engine.js';
import { StepFunTeachProvider } from './teach-provider.js';
import { DemoTeachProvider } from './teach-demo.js';
import { synthesize, transcribe, voiceConfiguration } from './voice.js';
import { authSettings, requireAccount } from './auth.js';

export const app = express();
app.disable('x-powered-by');
if (process.env.VERCEL) app.set('trust proxy', 1);
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
// Accounts (Supabase Google sign-in): every /api route except /api/config and /api/health needs a valid access
// token, but only when SUPABASE_URL and SUPABASE_ANON_KEY are both set. Otherwise this does nothing.
app.use('/api', requireAccount);
// Bound public, paid model calls even when a browser does not send Origin.
const windows = new Map<string, { starts: number; count: number }>();
/** Tests only: start every rate-limit window afresh. */
export function clearRateLimits() { windows.clear(); }
app.use(['/api/topic', '/api/teach', '/api/judge', '/api/concepts', '/api/turn', '/api/transcribe', '/api/speech'], (req, res, next) => {
  const now = Date.now();
  const ip = `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  // Signed in: 60 per account, so a shared network doesn't share one budget, and a looser 180 per IP, so one client
  // with many accounts can't multiply its budget. Accounts off: 60 per IP.
  const budgets: [string, number][] = req.user ? [[`user:${req.user.id}`, 60], [ip, 180]] : [[ip, 60]];
  if (windows.size > 10000) for (const [key, value] of windows) if (now - value.starts >= 600000) windows.delete(key);
  let retryAt = 0;
  for (const [client, limit] of budgets) {
    const window = windows.get(client);
    const entry = !window || now - window.starts >= 600000 ? { starts: now, count: 0 } : window;
    windows.set(client, entry);
    if (++entry.count > limit) retryAt = Math.max(retryAt, entry.starts + 600000);
  }
  if (retryAt) { res.setHeader('Retry-After', String(Math.ceil((retryAt - now) / 1000))); return res.status(429).json({ error: 'Too many study requests. Please try again in a few minutes.', code: 'RATE_LIMIT' }); }
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
app.get('/api/config', (_req, res) => res.json({ liveAvailable: Boolean(process.env.STEPFUN_API_KEY?.trim() && (!process.env.VERCEL || process.env.SESSION_SECRET?.trim())), voiceAvailable: voiceConfiguration().available, judgeDebugAvailable: process.env.ENABLE_JUDGE_DEBUG === 'true', provider: 'Step 5 Preview', limits: LIMITS,
  // The public Supabase URL and anon key, or null when accounts are off. The browser builds its Supabase client from this.
  auth: authSettings() }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/topic', async (req, res) => {
  const request = createTopicSchema.parse(req.body);
  const teachProvider = request.mode === 'demo' ? new DemoTeachProvider(request.sampleId ?? 'analysis') : new StepFunTeachProvider();
  res.json(await createTeachTopic(request, teachProvider, req.user?.id));
});
app.post('/api/teach', async (req, res) => {
  const request = teachTurnSchema.parse(req.body);
  const state = openTeachState(request.stateToken, request.topicId, request.documents, req.user?.id);
  gate.begin({ sessionId: request.topicId, turnId: request.turnId, revision: request.revision });
  const teachProvider = state.sample ? new DemoTeachProvider(state.sampleId ?? 'analysis') : new StepFunTeachProvider();
  const result = await runTeachTurn(request, teachProvider, process.env.ENABLE_JUDGE_DEBUG === 'true', req.user?.id);
  gate.assertCurrent({ sessionId: request.topicId, turnId: request.turnId, revision: request.revision });
  if (!res.destroyed) res.json(result);
});
// Background grading: the Step 5 Judge grades messages Stu has already answered (and writes the teach-back on completion).
app.post('/api/judge', async (req, res) => {
  const request = judgeTurnSchema.parse(req.body);
  const state = openTeachState(request.stateToken, request.topicId, request.documents, req.user?.id);
  const teachProvider = state.sample ? new DemoTeachProvider(state.sampleId ?? 'analysis') : new StepFunTeachProvider();
  const result = await runJudgeTurn(request, teachProvider, process.env.ENABLE_JUDGE_DEBUG === 'true', req.user?.id);
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
// The API server stores no uploaded files or conversations (with accounts on, the browser saves them to the
// signed-in user's own Supabase row and bucket); clear only its transient revision guard.
app.delete('/api/session/:id', (req, res) => { gate.remove(req.params.id); res.status(204).end(); });

const audioTypes: Record<string, string> = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'm4a', 'audio/x-m4a': 'm4a' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => {
  if (!audioTypes[file.mimetype.split(';')[0]]) callback(new ApiError(415, 'This recording format is not supported. Try recording again or type your explanation.'));
  else callback(null, true);
} });
// StepFun voice (James's adapter): JSON/SSE speech recognition and chunked WAV speech, cancelled if the browser leaves.
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file?.buffer.length) throw new ApiError(400, 'No recording was received. Try again or type your explanation.');
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  const mime = req.file.mimetype.split(';')[0];
  const text = await transcribe(req.file.buffer, mime, audioTypes[mime], controller.signal);
  if (!res.destroyed) res.json({ text });
});
app.post('/api/speech', async (req, res) => {
  const { text } = z.object({ text: z.string().min(1).max(4096) }).parse(req.body);
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  const speech = await synthesize(text, controller.signal);
  if (!res.destroyed) res.type(speech.contentType).send(speech.buffer);
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'That Miso action was not found.' }));
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  // A cancelled voice request has no listener left to answer.
  if (res.destroyed || res.headersSent) return;
  if (error instanceof ApiError) { res.status(error.status).json({ error: error.message, code: error.code, ...(error.detail ? { detail: error.detail } : {}) }); return; }
  if (error instanceof z.ZodError) { res.status(400).json({ error: 'This request contains missing or invalid study data. Your draft is safe; reopen the notes and try again.', code: 'INVALID_REQUEST' }); return; }
  if (error instanceof multer.MulterError) { res.status(413).json({ error: 'Recordings must be under 12 MB. Try a shorter explanation or type it instead.', code: 'AUDIO_TOO_LARGE' }); return; }
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') { res.status(413).json({ error: 'This collection is too large to process at once. Try fewer pages.' }); return; }
  // Never log uploaded lecture text, provider response bodies, credentials, or recordings.
  console.error('Miso request failed:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({ error: 'Miso could not finish this action. Your draft is safe; please retry.', code: 'SERVER_ERROR' });
};
app.use(errors);
