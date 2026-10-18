import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ApiError, LIMITS, conceptRequestSchema, turnRequestSchema } from './schema.js';
import { createConcepts, RevisionGate, runTurn } from './engine.js';
import { DemoProvider } from './demo.js';
import { GeminiProvider } from './provider.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.get('origin');
  if (origin) {
    try {
      const url = new URL(origin);
      const host = req.hostname;
      if (url.hostname !== host && !(['localhost', '127.0.0.1'].includes(url.hostname) && ['localhost', '127.0.0.1'].includes(host))) throw new Error();
    } catch { return res.status(403).json({ error: 'This request must come from the Teach Stu application.' }); }
  }
  next();
});
const gate = new RevisionGate();
const provider = (mode: 'live' | 'demo', sampleId?: 'analysis' | 'research') => {
  if (mode === 'demo') {
    if (!sampleId) throw new ApiError(400, 'Choose a bundled sample to start a sample demo.', 'DEMO_ONLY');
    return new DemoProvider(sampleId);
  }
  return new GeminiProvider();
};
app.get('/api/config', (_req, res) => res.json({ liveAvailable: Boolean(process.env.GEMINI_API_KEY), voiceAvailable: Boolean(process.env.OPENAI_API_KEY), provider: 'Gemini', limits: LIMITS }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/concepts', async (req, res) => {
  const request = conceptRequestSchema.parse(req.body);
  res.json(await createConcepts(request, provider(request.mode, request.sampleId)));
});
app.post('/api/turn', async (req, res) => {
  const request = turnRequestSchema.parse(req.body);
  gate.begin(request);
  const result = await runTurn(request, provider(request.mode, request.sampleId));
  gate.assertCurrent(request);
  if (!res.destroyed) res.json(result);
});
// The server stores no uploaded files or conversations; clear only its transient revision guard.
app.delete('/api/session/:id', (req, res) => { gate.remove(req.params.id); res.status(204).end(); });

const audioTypes: Record<string, string> = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mp4': 'mp4', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/x-m4a': 'm4a' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => {
  if (!audioTypes[file.mimetype.split(';')[0]]) callback(new ApiError(415, 'This recording format is not supported. Try typing, or use a browser that records WebM or MP4.'));
  else callback(null, true);
} });
async function voiceFetch(path: string, init: RequestInit) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ApiError(503, 'Voice needs OPENAI_API_KEY on the server. You can complete the session by typing.', 'VOICE_NOT_CONFIGURED');
  let response: Response;
  try { response = await fetch(`https://api.openai.com/v1/audio/${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(45_000) }); }
  catch { throw new ApiError(504, 'The voice service did not respond in time. Try again or continue typing.', 'VOICE_TIMEOUT'); }
  if (!response.ok) throw new ApiError(502, 'The voice service could not complete this request. Check server voice credentials and model access, or continue typing.', 'VOICE_ERROR');
  return response;
}
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file?.buffer.length) throw new ApiError(400, 'No recording was received. Try again or type your explanation.');
  const mime = req.file.mimetype.split(';')[0];
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(req.file.buffer)], { type: mime }), `recording.${audioTypes[mime]}`);
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
  form.append('response_format', 'json');
  const response = await voiceFetch('transcriptions', { method: 'POST', body: form });
  const data = await response.json() as { text?: string };
  if (!data.text?.trim()) throw new ApiError(422, 'No clear speech was found in that recording. Try again or type your explanation.');
  res.json({ text: data.text });
});
app.post('/api/speech', async (req, res) => {
  const { text } = z.object({ text: z.string().min(1).max(4096) }).parse(req.body);
  const response = await voiceFetch('speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', input: text, voice: process.env.OPENAI_TTS_VOICE || 'coral', response_format: 'mp3', instructions: 'Speak like a calm college classmate: clear, warm, measured, and respectful. Read mathematical notation naturally. Never use a baby voice.' }),
  });
  res.type('audio/mpeg').send(Buffer.from(await response.arrayBuffer()));
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'That Teach Stu action was not found.' }));
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
  console.error('Teach Stu request failed:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({ error: 'Teach Stu could not finish this action. Your draft is safe; please retry.', code: 'SERVER_ERROR' });
};
app.use(errors);

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 3001);
  app.listen(port, '127.0.0.1', () => console.log(`Teach Stu API listening on http://127.0.0.1:${port}`));
}
