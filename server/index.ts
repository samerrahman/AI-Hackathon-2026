import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ApiError, LIMITS, conceptRequestSchema, turnRequestSchema } from './schema.js';
import { createConcepts, RevisionGate, runTurn } from './engine.js';
import { DemoProvider } from './demo.js';
import { StepFunStudyProvider } from './stepfun-provider.js';
import { studyConfiguration } from './config.js';
import { voiceConfiguration, transcribe, synthesize } from './voice.js';
import { CollectionCache } from './collections.js';
import type { TurnStreamEvent, TurnTimings } from '../shared/types.js';

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
    } catch { return res.status(403).json({ error: 'This request must come from the Stu application.' }); }
  }
  next();
});
const gate = new RevisionGate();
const collections = new CollectionCache();
const provider = (mode: 'live' | 'demo', sampleId?: 'analysis' | 'research') => {
  if (mode === 'demo') {
    if (!sampleId) throw new ApiError(400, 'Choose a bundled sample to start a sample demo.', 'DEMO_ONLY');
    return new DemoProvider(sampleId);
  }
  studyConfiguration();
  return new StepFunStudyProvider();
};
app.get('/api/config', (_req, res) => {
  const voice = voiceConfiguration();
  res.json({ ...studyConfiguration(), voiceAvailable: voice.available, voiceProvider: voice.provider, voiceKey: voice.keyName, limits: LIMITS });
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/concepts', async (req, res) => {
  const request = conceptRequestSchema.parse(req.body);
  const result=await createConcepts(request, provider(request.mode, request.sampleId));
  res.json({...result,...(request.mode==='live'?{collectionId:collections.put(request.sessionId,request.documents)}:{})});
});
app.post('/api/turn', async (req, res) => {
  const receivedAt=Date.now(),started=performance.now();
  const collectionId=typeof req.body.collectionId==='string'?req.body.collectionId:undefined;
  const documents=collectionId?collections.get(collectionId,req.body.sessionId):req.body.documents;
  const request = turnRequestSchema.parse({...req.body,documents});
  gate.begin(request);
  const controller=new AbortController();
  res.once('close',()=>{if(!res.writableEnded)controller.abort();});
  const timings:TurnTimings={contextMs:0,totalMs:0,providerCalls:[],submissionToReceiptMs:request.submittedAt?Math.max(0,receivedAt-request.submittedAt):undefined};
  const streaming=req.accepts('text/event-stream')==='text/event-stream'&&req.get('accept')?.includes('text/event-stream');
  const identifiers={sessionId:request.sessionId,turnId:request.turnId,revision:request.revision,conceptId:request.concept.id};
  const send=(event:TurnStreamEvent)=>{if(!res.destroyed&&!controller.signal.aborted){gate.assertCurrent(request);res.write(`data: ${JSON.stringify(event)}\n\n`);}};
  if(streaming){res.status(200).set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'});res.flushHeaders();send({...identifiers,type:'ready',receivedAt});}
  try{
    const result = await runTurn(request, provider(request.mode, request.sampleId), {
      signal:controller.signal,onContext:ms=>{timings.contextMs=ms;},onMetrics:metrics=>timings.providerCalls.push(metrics),
      ...(streaming?{onText:(text:string)=>{timings.firstVisibleMs??=performance.now()-started;send({...identifiers,type:'text',text});}}:{}),
    });
    gate.assertCurrent(request);
    timings.totalMs=performance.now()-started;timings.firstVisibleMs??=timings.totalMs;
    const complete={...result,timings,...(request.mode==='live'?{collectionId:collectionId??collections.put(request.sessionId,request.documents)}:{})};
    if(!res.destroyed){if(streaming){send({...identifiers,type:'complete',result:complete});res.end();}else res.json(complete);}
  }catch(error){
    if(!streaming)throw error;
    if(!res.destroyed&&!controller.signal.aborted){
      const known=error instanceof ApiError;
      // Errors are final protocol events; never leak raw provider text or private assessments.
      res.write(`data: ${JSON.stringify({...identifiers,type:'error',error:known?error.message:'Stu could not finish this response. Your draft is safe; retry.',code:known?error.code:'STREAM_ERROR'})}\n\n`);res.end();
    }
  }
});
// Remove the transient source cache and revision guard; originals live only in the browser.
app.delete('/api/session/:id', (req, res) => { gate.remove(req.params.id);collections.remove(req.params.id); res.status(204).end(); });

const audioTypes: Record<string, string> = { 'audio/mp4': 'mp4', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/x-m4a': 'm4a' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => {
  if (!audioTypes[file.mimetype.split(';')[0]]) callback(new ApiError(415, 'This recording format is not supported. Record again to convert the audio to WAV, or continue typing.'));
  else callback(null, true);
} });
const audioLimits=new Map<string,{since:number;count:number;active:number}>();
app.use(['/api/transcribe','/api/speech'],(req,res,next)=>{
  const id=req.ip||'local',now=Date.now();
  let entry=audioLimits.get(id);
  if(!entry||now-entry.since>60_000){entry={since:now,count:0,active:entry?.active||0};audioLimits.set(id,entry);}
  if(entry.active>=2||entry.count>=30){res.status(429).json({error:'Voice is busy. Wait a moment or keep typing.',code:'VOICE_RATE_LIMIT'});return;}
  entry.count++;entry.active++;let done=false;
  const release=()=>{if(!done){done=true;entry!.active--;}};res.once('finish',release);res.once('close',release);
  if(audioLimits.size>500)for(const [key,value] of audioLimits)if(now-value.since>60_000&&!value.active)audioLimits.delete(key);
  next();
});
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
app.use('/api', (_req, res) => res.status(404).json({ error: 'That Stu action was not found.' }));
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (res.destroyed) return;
  if (error instanceof ApiError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
  if (error instanceof z.ZodError) { res.status(400).json({ error: 'This request contains missing or invalid study data. Your draft is safe; reopen the notes and try again.', code: 'INVALID_REQUEST' }); return; }
  if (error instanceof multer.MulterError) { res.status(413).json({ error: 'Recordings must be under 12 MB. Try a shorter explanation or type it instead.', code: 'AUDIO_TOO_LARGE' }); return; }
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') { res.status(413).json({ error: 'This collection is too large to process at once. Try fewer pages.' }); return; }
  // Never log uploaded lecture text, provider response bodies, credentials, or recordings.
  console.error('Stu request failed:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({ error: 'Stu could not finish this action. Your draft is safe; please retry.', code: 'SERVER_ERROR' });
};
app.use(errors);

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 3001);
  app.listen(port, '127.0.0.1', () => console.log(`Stu API listening on http://127.0.0.1:${port}`));
}
