import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SourceSpan } from '../shared/types.js';
import { validateSources, requireReferences } from './engine.js';
import { scopeFor, stateKey } from './state.js';
import { ApiError } from './schema.js';
import { rubricSchema, judgeSchema, relearnBriefSchema, stuSchema, type CreateTopicRequest, type Depth, type Focus, type JudgeResult, type JudgeTurnRequest, type RelearnBrief, type TeachMode, type TeachTurnRequest } from './teach-schema.js';
import type { BriefInput, TeachProvider, StuInput } from './teach-provider.js';

type Message = { id: string; role: 'user' | 'assistant'; text: string };
type Evidence = { rubricItemId: string; teacherMessageId: string; quote: string };
type Item = { id: string; ideaIndex: number; stage: 'cover' | 'explain' | 'connect'; requirement: string; sourceIds: string[] };
export interface TeachState {
  version: 1; topicId: string; scope: string; title: string; depth: Depth; sample: boolean; sampleId?: 'analysis' | 'research';
  mode: TeachMode; rubric: Item[]; coreIdeas: string[]; credited: Record<string, Evidence>; revoked: Evidence[];
  transcript: Message[]; pastProblems: { type: string; description: string }[]; styles: string[]; quizTurn: number; revision: number;
  /** Teacher messages Stu has answered but the Step 5 Judge has not graded yet. */
  pendingJudge?: string[];
  /** Set when grading completes the topic: the next /api/judge call writes the re-learn brief and Stu's teach-back. */
  pendingBrief?: boolean;
  /** A teacher-grounded question from the last grading, used once for Stu's next reply. */
  lastFocus?: Focus | null;
}
export interface SafeDebug {
  credits: { itemId: string; quote: string }[]; revocations: { itemId: string; quote: string }[];
  problems: { type: string; description: string }[]; focus?: { type: string; anchorQuote: string; instruction: string };
  mistakeAccepted: boolean; models: { judge: string; stu: string }; durationMs: { judge: number; stu: number };
}
export interface TeachResponse {
  topicId: string; stateToken: string; progress: { total: number; credited: number; percent: number; mode: TeachMode };
  message?: Message & { sourceIds?: string[] }; transition?: boolean; liveStep5: boolean; debug?: SafeDebug;
  /** The reply was sent before grading: call /api/judge next. */
  judgePending?: boolean;
  /** Teacher message ids this grading covered. */
  judgedMessageIds?: string[];
  /** Grading finished the topic: call /api/judge once more for Stu's teach-back. */
  next?: 'brief';
}
function seal(state: TeachState): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', stateKey(), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
}
export function openTeachState(token: string, topicId: string, documents: TeachTurnRequest['documents']): TeachState {
  try {
    const bytes = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', stateKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const state = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as TeachState;
    if (state.version !== 1 || state.topicId !== topicId || state.scope !== scopeFor(documents) || !Array.isArray(state.rubric) || !Array.isArray(state.transcript)) throw new Error('State mismatch');
    return state;
  } catch { throw new ApiError(409, 'This topic state no longer matches its notes. Your local notes are still saved; start a new topic.', 'STATE_MISMATCH'); }
}
function progress(state: TeachState) {
  const total = state.rubric.length;
  const credited = Object.keys(state.credited).length;
  return { total, credited, percent: Math.round(credited / total * 100), mode: state.mode };
}
// Smaller than before (24 spans, 24k characters): every extra input token slows Step 5 Preview down.
function relevantJudgeSources(all: SourceSpan[], state: TeachState, latest: string): SourceSpan[] {
  const needed = new Set(state.rubric.flatMap(item => item.sourceIds));
  const terms = new Set(latest.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
  const ranked = all.map(span => ({ span, score: (needed.has(span.id) ? 10 : 0) + [...terms].filter(term => span.text.toLowerCase().includes(term)).length }))
    .sort((a, b) => b.score - a.score);
  let chars = 0;
  return ranked.filter(({ span }, index) => { if (index >= 24 || chars + span.text.length > 24_000) return false; chars += span.text.length; return true; }).map(x => x.span);
}
function isShortAffirmation(text: string): boolean {
  const plain = text.toLowerCase().replace(/[^a-z\s]/g, '').trim().replace(/\s+/g, ' ');
  return /^(yes|yep|yeah|exactly|right|correct|sure|ok|okay|i agree|you got it|thats right|that is right|sounds right|yes exactly|yes thats right|yes that is right)$/.test(plain);
}
function validEvidence(e: Evidence, messages: Message[], itemIds: Set<string>, used: Set<string>): boolean {
  if (!itemIds.has(e.rubricItemId)) return false;
  const message = messages.find(m => m.id === e.teacherMessageId && m.role === 'user');
  if (!message || !message.text.includes(e.quote) || isShortAffirmation(message.text)) return false;
  const key = `${e.rubricItemId}\0${e.teacherMessageId}\0${e.quote}`;
  if (used.has(key)) return false;
  used.add(key);
  return true;
}
function validatedAnchor(anchor: { teacherMessageId: string; anchorQuote: string }, messages: Message[]): boolean {
  const message = messages.find(m => m.id === anchor.teacherMessageId && m.role === 'user');
  return Boolean(message && message.text.includes(anchor.anchorQuote) && !isShortAffirmation(message.text));
}
function genericFocus(latest: Message): Focus {
  return { type: 'vague', teacherMessageId: latest.id, anchorQuote: latest.text.slice(0, 160), instruction: 'ask_clarify' };
}
const focusInstruction: Record<string, Focus['instruction']> = { wrong: 'ask_why', vague: 'ask_clarify', missing_step: 'ask_order', undefined_term: 'ask_define', off_topic: 'ask_clarify' };
// The Judge no longer writes Stu's question; the first verified problem becomes a teacher-quoted nudge for the next reply.
function focusFromProblems(problems: JudgeResult['problems']): Focus | null {
  const problem = problems[0];
  return problem ? { type: problem.type, teacherMessageId: problem.teacherMessageId, anchorQuote: problem.quote.slice(0, 160), instruction: focusInstruction[problem.type] ?? 'ask_clarify' } : null;
}
function safeProblems(problems: JudgeResult['problems'], all: SourceSpan[]) {
  const validIds = new Set(all.map(s => s.id));
  return problems.filter(problem => problem.sourceIds.every(id => validIds.has(id)));
}
const problemDescriptions: Record<string, string> = {
  wrong: 'A factual claim needs correction.', vague: 'The explanation needs a more specific statement.',
  missing_step: 'A reasoning step is missing.', undefined_term: 'A term needs defining.', off_topic: 'The explanation moved away from the topic.',
};
function validateStuText(text: string, mode: TeachMode) {
  const questions = (text.match(/\?/g) || []).length;
  const limit = mode === 'teach' ? 450 : 900;
  // Details are counts only, never Stu's text.
  // One real question, plus at most one tag such as "…, right?" on a restatement.
  if (questions < 1 || questions > 2 || text.length > limit) throw new ApiError(502, 'Stu returned an incomplete response. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT', `stu: ${questions} question marks, ${text.length}/${limit} characters`);
  const sentences = text.split(/[.!?]+/).filter(part => part.trim()).length;
  if (mode === 'teach' && sentences > 4) throw new ApiError(502, 'Stu returned an overlong response. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT', `stu: ${sentences} sentences`);
}
// Stu's output rules are strict, so give a fresh sample one more try before surfacing an error.
// Provider failures (network, auth, balance) are not retried here.
async function stuReply(provider: TeachProvider, input: StuInput) {
  for (let attempt = 1; ; attempt++) {
    try {
      const stuCall = await provider.stu(input);
      const stu = stuSchema.parse(stuCall.data);
      validateStuText(stu.text, input.mode);
      if (input.lastQuestionStyle === stu.questionStyle) throw new ApiError(502, 'Stu repeated a question style. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT', `stu: repeated ${stu.questionStyle} style`);
      return { stuCall, stu };
    } catch (error) {
      // Retry broken or runaway output once; never retry provider, auth, balance or timeout failures.
      const retryable = error instanceof z.ZodError || (error instanceof ApiError && error.code === 'INVALID_MODEL_OUTPUT');
      if (attempt >= 2 || !retryable) throw error;
    }
  }
}
function verifiedRelearnBrief(candidate: RelearnBrief, state: TeachState, sources: SourceSpan[]) {
  const brief = relearnBriefSchema.parse(candidate);
  if (sources.length) requireReferences(brief.sourceIds, sources); else brief.sourceIds = [];
  if (!Object.values(state.credited).some(e => e.quote.includes(brief.teacherQuote))) throw new ApiError(502, 'The re-learn brief lacked verified teacher wording. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT');
  if (state.pastProblems.some(p => p.type === 'wrong') && !brief.correction.trim()) throw new ApiError(502, 'The re-learn brief omitted a needed correction. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT');
  return brief;
}
function briefInput(state: TeachState, sources: SourceSpan[], transcript: Message[], transition: boolean): BriefInput {
  const latest = [...transcript].reverse().find(m => m.role === 'user')?.text ?? '';
  return { title: state.title, depth: state.depth, sources: relevantJudgeSources(sources, state, latest), coreIdeas: state.coreIdeas,
    rubric: state.rubric.map(({ stage, requirement, sourceIds }) => ({ stage, requirement, sourceIds })),
    verifiedTeacherQuotes: Object.values(state.credited).map(e => e.quote), pastProblems: state.pastProblems.slice(-12),
    transcript: transcript.slice(-12), quizTurn: state.quizTurn, transition };
}
const liveStep5 = (state: TeachState, model: string) => !state.sample && model === 'step-5-preview';
// Without notes there is nothing to cite; the Judge grades from its own knowledge.
const sourcesOf = (documents: CreateTopicRequest['documents']) => documents.length ? validateSources(documents) : [];
export async function createTeachTopic(request: CreateTopicRequest, provider: TeachProvider): Promise<TeachResponse> {
  const sources = sourcesOf(request.documents);
  if (request.mode === 'demo' && !request.sampleId) throw new ApiError(400, 'Choose a bundled sample for a sample session.', 'DEMO_ONLY');
  const generated = await provider.rubric({ title: request.title, depth: request.depth, sources });
  const draft = rubricSchema.parse(generated.data);
  const rubric = draft.items.map(item => { if (sources.length) requireReferences(item.sourceIds, sources); return { ...item, sourceIds: sources.length ? item.sourceIds : [], id: randomUUID() }; });
  const topicId = randomUUID();
  const state: TeachState = { version: 1, topicId, scope: scopeFor(request.documents), title: request.title, depth: request.depth,
    sample: request.mode === 'demo', sampleId: request.sampleId, mode: 'teach', rubric, coreIdeas: draft.coreIdeas,
    credited: {}, revoked: [], transcript: [], pastProblems: [], styles: [], quizTurn: 0, revision: 0, pendingJudge: [], pendingBrief: false, lastFocus: null };
  return { topicId, stateToken: seal(state), progress: progress(state),
    message: { id: randomUUID(), role: 'assistant', text: 'Hi! I’m Stu. Teach me this topic in your own words. What should I know first?' },
    liveStep5: false };
}
/**
 * One teacher message. In teach mode only fast Stu runs here; the Step 5 Judge grades the message
 * afterwards through runJudgeTurn, so the reply never waits on the slower model. In re-learn mode the
 * reply depends on a checked brief, so the brief (Step 5) and Stu run in sequence.
 */
export async function runTeachTurn(request: TeachTurnRequest, provider: TeachProvider, _debugEnabled = false): Promise<TeachResponse> {
  const sources = sourcesOf(request.documents);
  const state = openTeachState(request.stateToken, request.topicId, request.documents);
  if (request.revision <= state.revision) throw new ApiError(409, 'A newer message already changed this topic. Reload your saved session.', 'STALE_TURN');
  if (state.transcript.some(m => m.id === request.messageId || m.id === request.turnId)) throw new ApiError(409, 'This message has already been used. Retry with your latest saved session.', 'STALE_TURN');
  const user: Message = { id: request.messageId, role: 'user', text: request.text };
  const transcript = [...state.transcript, user];
  if (state.mode === 'relearn') return relearnReply(state, transcript, sources, provider, request.revision);
  const focus = state.lastFocus && validatedAnchor(state.lastFocus, transcript) ? state.lastFocus : genericFocus(user);
  const { stu } = await stuReply(provider, { depth: state.depth, mode: 'teach', transcript: transcript.slice(-20),
    director: { focus: { type: focus.type, teacherMessageId: focus.teacherMessageId, anchorQuote: focus.anchorQuote, instruction: focus.instruction }, mistake: null },
    lastQuestionStyle: state.styles.at(-1) });
  const assistant: Message = { id: randomUUID(), role: 'assistant', text: stu.text };
  const proposed: TeachState = { ...state, transcript: [...transcript, assistant].slice(-60), pendingJudge: [...(state.pendingJudge ?? []), user.id],
    lastFocus: null, styles: [...state.styles, stu.questionStyle], revision: request.revision };
  return { topicId: state.topicId, stateToken: seal(proposed), progress: progress(proposed), message: assistant, judgePending: true, liveStep5: false };
}
async function relearnReply(state: TeachState, transcript: Message[], sources: SourceSpan[], provider: TeachProvider, revision: number): Promise<TeachResponse> {
  const briefCall = await provider.brief(briefInput(state, sources, transcript, false));
  const brief = verifiedRelearnBrief(briefCall.data, state, sources);
  const { stu } = await stuReply(provider, { depth: state.depth, mode: 'relearn', transcript: transcript.slice(-20),
    director: { brief, quizTurn: state.quizTurn, transition: false }, lastQuestionStyle: state.styles.at(-1) });
  const assistant: Message = { id: randomUUID(), role: 'assistant', text: stu.text };
  const proposed: TeachState = { ...state, transcript: [...transcript, assistant].slice(-60), pendingBrief: false,
    styles: [...state.styles, stu.questionStyle], quizTurn: state.quizTurn + 1, revision };
  return { topicId: state.topicId, stateToken: seal(proposed), progress: progress(proposed),
    message: { ...assistant, sourceIds: brief.sourceIds }, liveStep5: liveStep5(state, briefCall.model) };
}
/** Grade every teacher message Stu has already answered, then (on completion) write Stu's teach-back. */
export async function runJudgeTurn(request: JudgeTurnRequest, provider: TeachProvider, debugEnabled = false): Promise<TeachResponse> {
  const sources = sourcesOf(request.documents);
  const state = openTeachState(request.stateToken, request.topicId, request.documents);
  if (state.pendingBrief) return startRelearn(state, sources, provider);
  const transcript = state.transcript;
  const pending = (state.pendingJudge ?? []).filter(id => transcript.some(m => m.id === id && m.role === 'user'));
  if (state.mode !== 'teach' || !pending.length) {
    return { topicId: state.topicId, stateToken: seal({ ...state, pendingJudge: [] }), progress: progress(state), judgedMessageIds: [], liveStep5: false };
  }
  const pendingIds = new Set(pending);
  const pendingText = transcript.filter(m => pendingIds.has(m.id)).map(m => m.text).join(' ');
  const judgeCall = await provider.judge({ title: state.title, depth: state.depth, sources: relevantJudgeSources(sources, state, pendingText),
    rubric: state.rubric.map(({ id, stage, requirement, sourceIds }) => ({ id, stage, requirement, sourceIds })), creditedItemIds: Object.keys(state.credited),
    pastProblems: state.pastProblems.slice(-12), transcript: transcript.slice(-16), pendingTeacherMessageIds: pending });
  const judge = judgeSchema.parse(judgeCall.data);
  const proposed: TeachState = { ...state, credited: { ...state.credited }, revoked: [...state.revoked], pastProblems: [...state.pastProblems], pendingJudge: [] };
  const itemIds = new Set(state.rubric.map(item => item.id));
  const usedCredits = new Set<string>(); const usedRevokes = new Set<string>();
  const validCredits = judge.credits.filter(e => pendingIds.has(e.teacherMessageId) && validEvidence(e, transcript, itemIds, usedCredits));
  const validRevokes = judge.revocations.filter(e => pendingIds.has(e.teacherMessageId) && validEvidence(e, transcript, itemIds, usedRevokes));
  const problems = safeProblems(judge.problems, sources).filter(problem => pendingIds.has(problem.teacherMessageId)
    && validatedAnchor({ teacherMessageId: problem.teacherMessageId, anchorQuote: problem.quote }, transcript));
  const blocked = new Set(problems.filter(problem => problem.type === 'wrong').flatMap(problem => problem.affectedRubricItemIds.filter(id => itemIds.has(id))));
  for (const credit of validCredits) if (!blocked.has(credit.rubricItemId)) proposed.credited[credit.rubricItemId] = credit;
  for (const revoke of validRevokes) { delete proposed.credited[revoke.rubricItemId]; proposed.revoked.push(revoke); }
  for (const problem of problems.filter(problem => problem.type === 'wrong')) for (const id of problem.affectedRubricItemIds) {
    if (proposed.credited[id]) { delete proposed.credited[id]; proposed.revoked.push({ rubricItemId: id, teacherMessageId: problem.teacherMessageId, quote: problem.quote }); }
  }
  proposed.pastProblems.push(...problems.filter(p => p.type === 'wrong').map(p => ({ type: p.type, description: p.description })));
  proposed.pastProblems = proposed.pastProblems.slice(-15);
  proposed.lastFocus = focusFromProblems(problems);
  const completed = Object.keys(proposed.credited).length === proposed.rubric.length && !problems.some(p => p.type === 'wrong');
  if (completed) { proposed.mode = 'relearn'; proposed.pendingBrief = true; }
  const debug: SafeDebug | undefined = debugEnabled ? {
    credits: validCredits.filter(e => proposed.credited[e.rubricItemId]?.teacherMessageId === e.teacherMessageId).map(e => ({ itemId: e.rubricItemId, quote: e.quote })),
    revocations: proposed.revoked.slice(state.revoked.length).map(e => ({ itemId: e.rubricItemId, quote: e.quote })),
    problems: problems.map(p => ({ type: p.type, description: problemDescriptions[p.type] })),
    ...(proposed.lastFocus ? { focus: { type: proposed.lastFocus.type, anchorQuote: proposed.lastFocus.anchorQuote, instruction: proposed.lastFocus.instruction } } : {}),
    mistakeAccepted: false, models: { judge: judgeCall.model, stu: provider.stuModel }, durationMs: { judge: judgeCall.durationMs, stu: 0 },
  } : undefined;
  return { topicId: state.topicId, stateToken: seal(proposed), progress: progress(proposed), judgedMessageIds: pending,
    ...(completed ? { transition: true, next: 'brief' as const } : {}), liveStep5: liveStep5(state, judgeCall.model), ...(debug ? { debug } : {}) };
}
async function startRelearn(state: TeachState, sources: SourceSpan[], provider: TeachProvider): Promise<TeachResponse> {
  const briefCall = await provider.brief(briefInput(state, sources, state.transcript, true));
  const brief = verifiedRelearnBrief(briefCall.data, state, sources);
  const { stu } = await stuReply(provider, { depth: state.depth, mode: 'relearn', transcript: state.transcript.slice(-20),
    director: { brief, quizTurn: state.quizTurn, transition: true }, lastQuestionStyle: state.styles.at(-1) });
  const assistant: Message = { id: randomUUID(), role: 'assistant', text: stu.text };
  const proposed: TeachState = { ...state, pendingBrief: false, transcript: [...state.transcript, assistant].slice(-60),
    styles: [...state.styles, stu.questionStyle], quizTurn: state.quizTurn + 1 };
  return { topicId: state.topicId, stateToken: seal(proposed), progress: progress(proposed),
    message: { ...assistant, sourceIds: brief.sourceIds }, transition: true, liveStep5: liveStep5(state, briefCall.model) };
}
