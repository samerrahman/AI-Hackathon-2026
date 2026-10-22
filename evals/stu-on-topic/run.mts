// Live eval: does Stu stay on the topic of the original notes? See README.md.
//   npx tsx evals/stu-on-topic/run.mts --label <name> [--turns 6] [--only <id,...>] [--concurrency 3] [--fresh-topics]
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { ApiError } from '../../server/schema.js';
import { createTeachTopic, openTeachState, runJudgeTurn, runTeachTurn, type TeachResponse } from '../../server/teach-engine.js';
import { StepFunTeachProvider, type BriefInput, type JudgeInput, type ModelResult, type StuInput, type TeachProvider } from '../../server/teach-provider.js';
import type { SourceSpan } from '../../shared/types.js';
import { createTopicSchema, judgeTurnSchema, teachTurnSchema, type CreateTopicRequest, type Depth, type JudgeResult, type RelearnBrief, type StuResult } from '../../server/teach-schema.js';
import { PERSONAS, moveFor, teacherMessage, teacherModel, type ChatLine, type Move, type Persona } from './teacher.mts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const FIXTURES = ['experiments', 'sequences', 'photosynthesis', 'supply-and-demand'] as const;
type Fixture = typeof FIXTURES[number];

// ---- setup -------------------------------------------------------------------------------------------
const { values: args } = parseArgs({ options: {
  label: { type: 'string' }, turns: { type: 'string', default: '6' }, only: { type: 'string' },
  concurrency: { type: 'string', default: '3' }, 'fresh-topics': { type: 'boolean', default: false },
} });
if (!args.label || !/^[\w.-]+$/.test(args.label)) { console.error('Usage: npx tsx evals/stu-on-topic/run.mts --label <name> [--turns N] [--only id,...] [--concurrency 3] [--fresh-topics]'); process.exit(2); }
const TURNS = Math.max(1, Number(args.turns) || 6);
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 3);
if (existsSync(join(repo, '.env'))) process.loadEnvFile(join(repo, '.env'));
if (!process.env.STEPFUN_API_KEY?.trim()) { console.error('STEPFUN_API_KEY is missing (put it in .env).'); process.exit(2); }
// A fixed secret so cached topic tokens stay readable across runs. Only this eval process uses it.
process.env.SESSION_SECRET = 'teach-stu-eval-stu-on-topic';

const resultsDir = join(here, 'results');
const outDir = join(resultsDir, args.label);
const cacheDir = join(resultsDir, 'cache');
mkdirSync(outDir, { recursive: true }); mkdirSync(cacheDir, { recursive: true });
// The provider logs content-free call metadata (durations, token counts); keep it out of the progress output.
const providerLog = join(outDir, 'provider.log');
const toProviderLog = (level: string) => (...parts: unknown[]) => appendFileSync(providerLog, `${JSON.stringify({ t: new Date().toISOString(), level, parts })}\n`);
console.info = toProviderLog('info'); console.warn = toProviderLog('warn');
const say = (line: string) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${line}\n`);

// ---- helpers -----------------------------------------------------------------------------------------
type ErrorInfo = { code: string; status?: number; message: string; detail?: string };
function describe(error: unknown): ErrorInfo {
  if (error instanceof ApiError) return { code: error.code, status: error.status, message: error.message, ...(error.detail ? { detail: error.detail } : {}) };
  if (error instanceof ZodError) return { code: 'SCHEMA', message: error.issues.slice(0, 4).map(issue => `${issue.path.join('.')} ${issue.message}`).join('; ') };
  return { code: 'ERROR', message: error instanceof Error ? error.message : String(error) };
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Retry only StepFun rate limits, with exponential backoff; everything else is the caller's to record. */
async function withLimitRetry<T>(run: () => Promise<T>): Promise<{ value: T; retries: number }> {
  for (let retries = 0; ; retries++) {
    try { return { value: await run(), retries }; }
    catch (error) {
      if (!(error instanceof ApiError && error.code === 'PROVIDER_LIMIT') || retries >= 5) throw error;
      await sleep(Math.min(60_000, 5_000 * 2 ** retries) + Math.random() * 1_000);
    }
  }
}
const ms = (start: number) => Math.round(performance.now() - start);
function stats(values: number[]) {
  if (!values.length) return { n: 0, median: null, p90: null, mean: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
  return { n: sorted.length, median, p90: at(0.9), mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length), min: sorted[0], max: sorted.at(-1)! };
}

/** Wraps the real provider to record what each model call received and returned, tagged with the turn it began in. */
type CallRecord = { turn: number; role: 'rubric' | 'judge' | 'brief' | 'stu'; ms: number; ok: boolean; error?: ErrorInfo; detail?: Record<string, unknown> };
class RecordingProvider implements TeachProvider {
  readonly calls: CallRecord[] = [];
  turn = -1;
  constructor(private readonly inner: TeachProvider) {}
  get judgeModel() { return this.inner.judgeModel; }
  get stuModel() { return this.inner.stuModel; }
  private async track<T>(role: CallRecord['role'], run: () => Promise<ModelResult<T>>, detail: (data: T) => Record<string, unknown> = () => ({})) {
    const turn = this.turn; const start = performance.now();
    try { const result = await run(); this.calls.push({ turn, role, ms: ms(start), ok: true, detail: detail(result.data) }); return result; }
    catch (error) { this.calls.push({ turn, role, ms: ms(start), ok: false, error: describe(error) }); throw error; }
  }
  rubric(input: { title: string; depth: Depth; sources: SourceSpan[] }) { return this.track('rubric', () => this.inner.rubric(input)); }
  judge(input: JudgeInput) {
    return this.track<JudgeResult>('judge', () => this.inner.judge(input), data => ({ sourcesSent: input.sources.length,
      credits: data.credits.length, revocations: data.revocations.length,
      problems: data.problems.map(({ type, description, quote }) => ({ type, description, quote })) }));
  }
  brief(input: BriefInput) { return this.track<RelearnBrief>('brief', () => this.inner.brief(input), data => ({ quizQuestion: data.quizQuestion })); }
  stu(input: StuInput) {
    const director = input.director as { focus?: unknown; brief?: unknown };
    return this.track<StuResult>('stu', () => this.inner.stu(input), data => ({ text: data.text, ...(director.focus ? { focus: director.focus } : {}) }));
  }
}

// ---- topics ------------------------------------------------------------------------------------------
interface Topic { fixture: Fixture; request: CreateTopicRequest; created: TeachResponse; notesText: string; syllabus: string[];
  rubric: { id: string; ideaIndex: number; stage: string; requirement: string }[] }
function loadRequest(fixture: Fixture): CreateTopicRequest {
  // Parsed exactly as POST /api/topic parses it.
  return createTopicSchema.parse(JSON.parse(readFileSync(join(here, 'fixtures', `${fixture}.json`), 'utf8')));
}
function topicFrom(fixture: Fixture, request: CreateTopicRequest, created: TeachResponse): Topic {
  const state = openTeachState(created.stateToken, created.topicId, request.documents);
  return { fixture, request, created, notesText: request.documents.flatMap(doc => doc.spans.map(span => span.text)).join('\n'),
    syllabus: state.coreIdeas, rubric: state.rubric.map(({ id, ideaIndex, stage, requirement }) => ({ id, ideaIndex, stage, requirement })) };
}
const topics = new Map<Fixture, Promise<Topic>>();
/** One rubric per fixture, cached in results/cache so every run (and every persona) grades against the same plan. */
function topic(fixture: Fixture): Promise<Topic> {
  if (!topics.has(fixture)) topics.set(fixture, (async () => {
    const request = loadRequest(fixture);
    const file = join(cacheDir, `${fixture}.json`);
    if (!args['fresh-topics'] && existsSync(file)) {
      try { return topicFrom(fixture, request, (JSON.parse(readFileSync(file, 'utf8')) as { created: TeachResponse }).created); }
      catch { say(`[${fixture}] cached topic no longer matches the fixture; rebuilding`); }
    }
    const provider = new StepFunTeachProvider();
    for (let attempt = 1; ; attempt++) {
      const start = performance.now();
      try {
        say(`[${fixture}] building rubric (attempt ${attempt})`);
        const { value: created } = await withLimitRetry(() => createTeachTopic(request, provider));
        writeFileSync(file, `${JSON.stringify({ fixture, createdAt: new Date().toISOString(), judgeModel: provider.judgeModel, rubricMs: ms(start), created }, null, 2)}\n`);
        const built = topicFrom(fixture, request, created);
        say(`[${fixture}] rubric ready in ${(ms(start) / 1000).toFixed(1)}s: ${built.syllabus.length} ideas, ${built.rubric.length} items`);
        return built;
      } catch (error) {
        say(`[${fixture}] rubric failed: ${describe(error).code}`);
        if (attempt >= 3) throw error;
      }
    }
  })());
  return topics.get(fixture)!;
}

// ---- one scenario ------------------------------------------------------------------------------------
interface Scenario { id: string; fixture: Fixture; persona: Persona }
interface TurnRecord {
  index: number; move: Move;
  teacher: { text: string; ms: number; attempts: number } | { error: ErrorInfo };
  stu?: { text: string; ms: number; retries: number; director?: unknown; samples: { text: string; ms: number; chosen: boolean }[] };
  judge?: { ms: number; retries: number; steps: number; judgedMessageIds: number; credits: { stage: string; ideaIndex: number; requirement: string; quote: string }[];
    revocations: number; problemTypes: string[]; rawProblems: unknown[]; focus?: unknown; teachBack?: string; next?: string };
  progress: TeachResponse['progress']; mode: string; errors: { at: 'teacher' | 'stu' | 'judge'; error: ErrorInfo }[];
}

async function runScenario(scenario: Scenario) {
  const t = await topic(scenario.fixture);
  const documents = t.request.documents;
  const provider = new RecordingProvider(new StepFunTeachProvider());
  const greeting = t.created.message?.text ?? '';
  const chat: ChatLine[] = greeting ? [{ role: 'stu', text: greeting }] : [];
  const turns: TurnRecord[] = [];
  let token = t.created.stateToken; let progress = t.created.progress;
  let revision = Date.now() * 1000; // like src/lib/turnGate.ts
  const output = {
    scenario: scenario.id, fixture: scenario.fixture, topic: t.request.title, persona: scenario.persona, depth: t.request.depth, label: args.label,
    models: { stu: provider.stuModel, judge: provider.judgeModel, teacher: teacherModel() }, startedAt: new Date().toISOString(), finishedAt: '',
    notesText: t.notesText, syllabus: t.syllabus, rubric: t.rubric.map(({ ideaIndex, stage, requirement }) => ({ ideaIndex, stage, requirement })), greeting,
    turns, final: { progress, mode: progress.mode }, errorCount: 0, calls: provider.calls,
  };
  const file = join(outDir, `${scenario.id}.json`);
  const save = () => { output.errorCount = turns.reduce((n, turn) => n + turn.errors.length, 0); writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`); };
  const itemById = new Map(t.rubric.map(item => [item.id, item]));
  for (let index = 0; index < TURNS; index++) {
    provider.turn = index;
    const errors: TurnRecord['errors'] = [];
    // 1. The simulated teacher writes the next message from the notes and the visible chat.
    let text: string;
    try {
      const message = await teacherMessage({ persona: scenario.persona, title: t.request.title, notesText: t.notesText, chat, turn: index });
      turns.push({ index, move: message.move, teacher: { text: message.text, ms: message.ms, attempts: message.attempts }, progress, mode: progress.mode, errors });
      text = message.text;
    } catch (error) {
      errors.push({ at: 'teacher', error: describe(error) });
      turns.push({ index, move: moveFor(scenario.persona, index), teacher: { error: describe(error) }, progress, mode: progress.mode, errors });
      save(); say(`[${scenario.id}] turn ${index + 1}: teacher failed`); continue;
    }
    const turn = turns.at(-1)!;
    // 2. /api/teach: Stu replies (threaded like teach() in src/App.tsx: fresh turn and message ids, a newer revision).
    revision += 1;
    const stuStart = performance.now();
    let reply: TeachResponse;
    try {
      const request = teachTurnSchema.parse({ topicId: t.created.topicId, stateToken: token, documents, turnId: randomUUID(), messageId: randomUUID(), revision, text });
      text = request.text;
      const { value, retries } = await withLimitRetry(() => runTeachTurn(request, provider, true));
      reply = value;
      const stuMs = ms(stuStart);
      token = reply.stateToken; progress = reply.progress;
      const stuText = reply.message?.text ?? '';
      const calls = provider.calls.filter(call => call.turn === index && call.role === 'stu' && call.ok);
      chat.push({ role: 'teacher', text });
      chat.push({ role: 'stu', text: stuText });
      turn.stu = { text: stuText, ms: stuMs, retries, director: calls.find(call => call.detail?.focus)?.detail?.focus,
        samples: calls.map(call => ({ text: String(call.detail?.text ?? ''), ms: call.ms, chosen: call.detail?.text === stuText })) };
    } catch (error) {
      errors.push({ at: 'stu', error: describe(error) }); turn.progress = progress; save();
      say(`[${scenario.id}] turn ${index + 1}: Stu failed ${describe(error).code}`); continue;
    }
    // 3. /api/judge: grade what Stu answered; a completed topic needs one more call for Stu's teach-back (runJudge() in src/App.tsx).
    if (reply.judgePending) {
      const judgeStart = performance.now();
      const judge: NonNullable<TurnRecord['judge']> = { ms: 0, retries: 0, steps: 0, judgedMessageIds: 0, credits: [], revocations: 0, problemTypes: [], rawProblems: [] };
      try {
        for (let step = 0; step < 2; step++) {
          const { value: graded, retries } = await withLimitRetry(() => runJudgeTurn(judgeTurnSchema.parse({ topicId: t.created.topicId, stateToken: token, documents }), provider, true));
          judge.steps++; judge.retries += retries;
          token = graded.stateToken; progress = graded.progress;
          judge.judgedMessageIds += graded.judgedMessageIds?.length ?? 0;
          if (graded.debug) {
            judge.credits.push(...graded.debug.credits.map(credit => { const item = itemById.get(credit.itemId); return { stage: item?.stage ?? '?', ideaIndex: item?.ideaIndex ?? -1, requirement: item?.requirement ?? '?', quote: credit.quote }; }));
            judge.revocations += graded.debug.revocations.length;
            judge.problemTypes.push(...graded.debug.problems.map(problem => problem.type));
            if (graded.debug.focus) judge.focus = graded.debug.focus;
          }
          if (graded.message) { judge.teachBack = graded.message.text; chat.push({ role: 'stu', text: graded.message.text }); }
          judge.next = graded.next;
          if (graded.next !== 'brief') break;
        }
      } catch (error) {
        // As in the app: the message stays queued in the token from /api/teach and is graded with the next one.
        errors.push({ at: 'judge', error: describe(error) });
      }
      judge.ms = ms(judgeStart);
      judge.rawProblems = provider.calls.filter(call => call.turn === index && call.role === 'judge' && call.ok).flatMap(call => (call.detail?.problems as unknown[]) ?? []);
      turn.judge = judge;
    }
    turn.progress = progress; turn.mode = progress.mode;
    output.final = { progress, mode: progress.mode };
    save();
    say(`[${scenario.id}] turn ${index + 1}/${TURNS} ${turn.move}: stu ${((turn.stu?.ms ?? 0) / 1000).toFixed(1)}s, judge ${((turn.judge?.ms ?? 0) / 1000).toFixed(1)}s, ` +
      `progress ${progress.credited}/${progress.total}${turn.judge?.problemTypes.length ? `, problems ${turn.judge.problemTypes.join('+')}` : ''}` +
      `${errors.length ? `, errors ${errors.map(e => `${e.at}:${e.error.code}`).join(' ')}` : ''}`);
  }
  output.finishedAt = new Date().toISOString();
  save();
  return output;
}

// ---- main --------------------------------------------------------------------------------------------
const all: Scenario[] = FIXTURES.flatMap(fixture => PERSONAS.map(persona => ({ id: `${fixture}-${persona}`, fixture, persona })));
const wanted = args.only?.split(',').map(part => part.trim()).filter(Boolean);
const scenarios = wanted ? all.filter(s => wanted.some(w => w === s.id || w === s.fixture || w === s.persona)) : all;
if (!scenarios.length) { console.error(`No scenario matches --only ${args.only}. Ids: ${all.map(s => s.id).join(', ')}`); process.exit(2); }
say(`label ${args.label}: ${scenarios.length} scenarios x ${TURNS} turns, concurrency ${CONCURRENCY} -> ${outDir}`);
const started = performance.now();
const outputs: Awaited<ReturnType<typeof runScenario>>[] = [];
const failures: { scenario: string; error: ErrorInfo }[] = [];
const queue = [...scenarios];
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) {
    try { outputs.push(await runScenario(next)); say(`[${next.id}] done`); }
    catch (error) { failures.push({ scenario: next.id, error: describe(error) }); say(`[${next.id}] FAILED: ${describe(error).code} ${describe(error).message}`); }
  }
}));

const turnsOf = outputs.flatMap(output => output.turns);
const summary = {
  label: args.label, finishedAt: new Date().toISOString(), wallSeconds: Math.round(ms(started) / 1000), turnsPerScenario: TURNS,
  models: outputs[0]?.models, failures,
  latencyMs: {
    stu: stats(turnsOf.flatMap(turn => turn.stu ? [turn.stu.ms] : [])),
    judge: stats(turnsOf.flatMap(turn => turn.judge && !turn.errors.some(e => e.at === 'judge') ? [turn.judge.ms] : [])),
    teacher: stats(turnsOf.flatMap(turn => 'text' in turn.teacher ? [turn.teacher.ms] : [])),
  },
  scenarios: [...outputs].sort((a, b) => all.findIndex(s => s.id === a.scenario) - all.findIndex(s => s.id === b.scenario)).map(output => {
    const answered = output.turns.filter(turn => turn.stu);
    return {
      scenario: output.scenario, topic: output.topic, persona: output.persona, turns: output.turns.length, stuReplies: answered.length, errors: output.errorCount,
      errorCodes: output.turns.flatMap(turn => turn.errors.map(e => `${e.at}:${e.error.code}`)),
      finalProgress: output.final.progress, mode: output.final.mode,
      stuMs: stats(answered.map(turn => turn.stu!.ms)), judgeMs: stats(output.turns.flatMap(turn => turn.judge ? [turn.judge.ms] : [])),
      problemTypes: output.turns.flatMap(turn => turn.judge?.problemTypes ?? []),
    };
  }),
};
writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
say(`done in ${summary.wallSeconds}s; Stu median ${summary.latencyMs.stu.median ?? '-'} ms, p90 ${'p90' in summary.latencyMs.stu ? summary.latencyMs.stu.p90 : '-'} ms; ${failures.length} failed scenarios`);
say(`summary: ${join(outDir, 'summary.json')}`);
