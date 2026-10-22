import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SourceSpan } from '../shared/types.js';
import { validateSources, requireReferences } from './engine.js';
import { scopeFor, stateKey } from './state.js';
import { ApiError } from './schema.js';
import { rubricSchema, judgeSchema, relearnBriefSchema, stuSchema, type CreateTopicRequest, type Depth, type Focus, type JudgeResult, type JudgeTurnRequest, type RelearnBrief, type TeachMode, type TeachTurnRequest } from './teach-schema.js';
import type { BriefInput, Lesson, TeachProvider, StuInput } from './teach-provider.js';

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
  /** The Supabase account that owns this topic, when accounts are on. Tokens sealed before accounts have none. */
  userId?: string;
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
/**
 * userId: the signed-in caller, passed only when accounts are on. A token sealed for another account is refused;
 * a token sealed before accounts (no userId) stays valid and is bound to this caller from its next seal on.
 */
export function openTeachState(token: string, topicId: string, documents: TeachTurnRequest['documents'], userId?: string): TeachState {
  let state: TeachState;
  try {
    const bytes = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', stateKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    state = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as TeachState;
    if (state.version !== 1 || state.topicId !== topicId || state.scope !== scopeFor(documents) || !Array.isArray(state.rubric) || !Array.isArray(state.transcript)) throw new Error('State mismatch');
  } catch { throw new ApiError(409, 'This topic state no longer matches its notes. Your local notes are still saved; start a new topic.', 'STATE_MISMATCH'); }
  if (!userId) return state;
  if (state.userId && state.userId !== userId) throw new ApiError(403, 'This topic belongs to a different account. Sign in with the account that started it.', 'WRONG_ACCOUNT');
  return state.userId ? state : { ...state, userId };
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
// Models copy quotes with small formatting drift (curly quotes, spacing, case, a trailing "…"). Compare
// normalized text so a real quote still counts; an invented or reworded quote still fails.
function normalizedQuote(text: string): string {
  return text.normalize('NFKC').replace(/[\u2018\u2019\u201B\u2032]/g, "'").replace(/[\u201C\u201D\u201F\u2033]/g, '"').replace(/[\u2010-\u2015]/g, '-')
    .replace(/(\.{3}|\u2026)/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim().replace(/^[\s"',;:.-]+|[\s"',;:.-]+$/g, '');
}
function quotedFrom(message: Message, quote: string): boolean {
  if (message.text.includes(quote)) return true;
  const needle = normalizedQuote(quote);
  return needle.length >= 3 && normalizedQuote(message.text).includes(needle);
}
function validEvidence(e: Evidence, messages: Message[], itemIds: Set<string>, used: Set<string>): boolean {
  if (!itemIds.has(e.rubricItemId)) return false;
  const message = messages.find(m => m.id === e.teacherMessageId && m.role === 'user');
  if (!message || !quotedFrom(message, e.quote) || isShortAffirmation(message.text)) return false;
  const key = `${e.rubricItemId}\0${e.teacherMessageId}\0${e.quote}`;
  if (used.has(key)) return false;
  used.add(key);
  return true;
}
function validatedAnchor(anchor: { teacherMessageId: string; anchorQuote: string }, messages: Message[]): boolean {
  const message = messages.find(m => m.id === anchor.teacherMessageId && m.role === 'user');
  return Boolean(message && quotedFrom(message, anchor.anchorQuote) && !isShortAffirmation(message.text));
}
function genericFocus(latest: Message): Focus {
  return { type: 'vague', teacherMessageId: latest.id, anchorQuote: latest.text.slice(0, 160), instruction: 'ask_clarify' };
}
// Asking what an off-topic phrase means only pulled Stu further into the tangent; he now steers back to the lesson.
const focusInstruction: Record<string, Focus['instruction']> = { wrong: 'ask_check', vague: 'ask_clarify', missing_step: 'ask_order', undefined_term: 'ask_define', off_topic: 'steer_back' };
// The Judge no longer writes Stu's question; the first verified problem becomes a teacher-quoted nudge for the next reply.
function focusFromProblems(problems: JudgeResult['problems']): Focus | null {
  const problem = problems[0];
  return problem ? { type: problem.type, teacherMessageId: problem.teacherMessageId, anchorQuote: problem.quote.slice(0, 160), instruction: focusInstruction[problem.type] ?? 'ask_clarify' } : null;
}
// Words that say what a message is about: lowercase, at least four letters, not filler, crudely stemmed.
const FILLER = new Set('that this with from they them their there then than what when where which while into about also just like your youre have were been being does doing done more most some such very much many each other only over under because would could should will cant dont isnt thats basically really actually kind sort thing things stuff yeah okay right'.split(' '));
function terms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).filter(word => !FILLER.has(word)).map(word => word.replace(/(ings|ing|ies|ied|es|ed|ly|s)$/, '')));
}
/**
 * The idea Stu should be trying to learn next: the unfinished idea the teacher is talking about if their
 * last message clearly is about one, otherwise the first idea whose gist has not been taught yet, then the
 * first unfinished one. Matching uses each idea's label, requirements and cited note text on the server only.
 */
export function lessonFor(state: TeachState, sources: SourceSpan[], latest: string): Lesson {
  const credited = new Set(Object.keys(state.credited));
  const spans = new Map(sources.map(span => [span.id, span.text]));
  const ideas = state.coreIdeas.map((label, index) => {
    const items = state.rubric.filter(item => item.ideaIndex === index);
    const vocabulary = terms([label, ...items.map(item => item.requirement), ...items.flatMap(item => item.sourceIds.map(id => spans.get(id) ?? ''))].join(' '));
    return { label, done: items.every(item => credited.has(item.id)), covered: items.some(item => item.stage === 'cover' && credited.has(item.id)), vocabulary };
  });
  const said = terms(latest);
  const talkingAbout = ideas.map(idea => ({ idea, overlap: [...said].filter(word => idea.vocabulary.has(word)).length }))
    .filter(entry => !entry.idea.done && entry.overlap >= 2).sort((a, b) => b.overlap - a.overlap)[0]?.idea;
  const current = talkingAbout ?? ideas.find(idea => !idea.covered) ?? ideas.find(idea => !idea.done) ?? ideas[0];
  return { title: state.title, ideas: state.coreIdeas, current: current?.label ?? state.title };
}
function safeProblems(problems: JudgeResult['problems'], all: SourceSpan[]) {
  const validIds = new Set(all.map(s => s.id));
  return problems.filter(problem => problem.sourceIds.every(id => validIds.has(id)));
}
const problemDescriptions: Record<string, string> = {
  wrong: 'A factual claim needs correction.', vague: 'The explanation needs a more specific statement.',
  missing_step: 'A reasoning step is missing.', undefined_term: 'A term needs defining.', off_topic: 'The explanation moved away from the topic.',
};
// Hard limits reject a reply outright: no question at all, or a wall of text. The live eval showed both
// samples often ran just past the old 450-character cap, failing about one turn in fifteen, so the tighter
// shape (450 characters, four sentences, two question marks) is now only preferred; see stuReply.
function validateStuText(text: string, mode: TeachMode) {
  const questions = (text.match(/\?/g) || []).length;
  const limit = mode === 'teach' ? 700 : 1200;
  // Details are counts only, never Stu's text.
  if (questions < 1 || text.length > limit) throw new ApiError(502, 'Stu returned an incomplete response. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT', `stu: ${questions} question marks, ${text.length}/${limit} characters`);
}
/** Ways a valid reply misses Stu's ideal shape; fewer is better. */
function stuShapeMisses(text: string, mode: TeachMode): number {
  // A tag on a restatement ("…, right?") is not a second question.
  const questions = (text.replace(/,?\s*(right|correct|yeah|huh|yes|no)\?/gi, '.').match(/\?/g) || []).length;
  const sentences = text.split(/[.!?]+/).filter(part => part.trim()).length;
  return Number(questions > 1) + Number(text.length > (mode === 'teach' ? 450 : 900)) + Number(mode === 'teach' && sentences > 4);
}
// Step 5 and Stu vary a lot from run to run in thinking time, and now and then a sample runs away or
// returns an empty answer. Two samples run in parallel and the first that passes validation wins; the
// slower one is ignored. Provider, auth, balance and timeout failures are surfaced; broken output is not.
// With \`misses\`, a valid sample that misses the ideal (score above 0) is held back while the other sample
// runs, and the held sample with the lowest score is used only if no ideal one arrives, so a preference can
// cost a few seconds but never an error.
async function firstValid<T>(attempt: () => Promise<T>, fallback: () => ApiError, misses?: (value: T) => number): Promise<T> {
  const samples = [attempt(), attempt()];
  try {
    if (!misses) return await Promise.any(samples);
    const held: { value: T; score: number }[] = [];
    try {
      return await Promise.any(samples.map(sample => sample.then(value => { const score = misses(value); if (!score) return value; held.push({ value, score }); throw new Error('not ideal'); })));
    } catch (error) {
      if (held.length) return held.sort((a, b) => a.score - b.score)[0].value;
      throw error;
    }
  } catch (error) {
    const errors: unknown[] = error instanceof AggregateError ? error.errors : [error];
    const retryable = (cause: unknown) => cause instanceof z.ZodError || (cause instanceof ApiError && (cause.code === 'INVALID_MODEL_OUTPUT' || cause.code === 'INVALID_SOURCE'));
    throw errors.find(cause => !retryable(cause)) ?? errors.find(cause => cause instanceof ApiError) ?? fallback();
  }
}
// Everyday words a confused student uses about anything; they never make a question a tangent.
const STU_WORDS = new Set(('wait okay sorry confus understand mean explain part work happen different same example idea lesson little lost think thought said say tell know again simple still need something someone another always never every less exact help start first next step whole make sense sure really point bit gues follow get got going come came turn turns keep used use much way ways time times kind talk talking part parts word words thing mix mixed wrong correct true happen happens actual basical whole question answer back main single before around through during inside outside people little should enough without between together important anything everything nothing problem number process change total simpl probabl definit').split(' '));
/**
 * Words in Stu's question that appear nowhere in the lesson: not in the notes, the rubric, the idea names, the
 * title, or anything the teacher said. Two or more mean Stu brought in a new subject of his own (the live
 * failure was "what do they use for energy at nighttime?" in a photosynthesis lesson with no night in it).
 */
export function tangentWords(reply: string, lessonText: string): string[] {
  const question = reply.split(/(?<=[.!?])\s+/).filter(sentence => sentence.includes('?')).join(' ') || reply;
  const allowed = terms(lessonText);
  // Short words are mostly everyday verbs and connectives ("grab", "after"); subjects are longer ("nighttime", "respiration").
  return [...terms(question)].filter(word => word.length >= 6 && !allowed.has(word) && ![...STU_WORDS].some(common => word.startsWith(common)));
}
const topicGuard = () => process.env.STU_TOPIC_GUARD !== 'off';
// When both samples fail (cut off while thinking, or no question) and there is time left, one more pair runs:
// a few extra seconds in a rare case instead of an error in the chat.
async function stuReply(provider: TeachProvider, input: StuInput, lessonText?: string) {
  const started = performance.now();
  try { return await stuPair(provider, input, lessonText); }
  catch (error) {
    if (!(error instanceof ApiError && error.code === 'INVALID_MODEL_OUTPUT') || performance.now() - started > 20_000) throw error;
    return stuPair(provider, input, lessonText);
  }
}
function stuPair(provider: TeachProvider, input: StuInput, lessonText?: string) {
  return firstValid(async () => {
    const stuCall = await provider.stu(input);
    const stu = stuSchema.parse(stuCall.data);
    validateStuText(stu.text, input.mode);
    if (input.lastQuestionStyle === stu.questionStyle) throw new ApiError(502, 'Stu repeated a question style. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT', `stu: repeated ${stu.questionStyle} style`);
    return { stuCall, stu };
  }, () => new ApiError(502, 'Stu returned an incomplete response. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT'),
  // A drifting question counts more than a long one: staying on the lesson matters most.
  ({ stu }) => stuShapeMisses(stu.text, input.mode) + (lessonText !== undefined && topicGuard() && tangentWords(stu.text, lessonText).length >= 2 ? 2 : 0));
}
// Long notes are sampled evenly for the planner: each page keeps its headings and then its text in reading
// order up to an equal share, so a 100-page PDF plans about as fast as a handout. Ids are unchanged, so
// citations still resolve, and the Judge later reads the full spans the rubric cites.
const PLAN_SOURCE_CHARACTERS = 40_000;
export function planSources(all: SourceSpan[], budget = PLAN_SOURCE_CHARACTERS): SourceSpan[] {
  if (all.reduce((n, span) => n + span.text.length, 0) <= budget) return all;
  const pages = new Map<string, SourceSpan[]>();
  for (const span of all) { const key = `${span.documentId}\0${span.pageIndex}`; pages.set(key, [...(pages.get(key) ?? []), span]); }
  const share = Math.max(200, Math.floor(budget / pages.size));
  const kept = new Map<string, SourceSpan>();
  for (const spans of pages.values()) {
    let room = share;
    for (const span of [...spans.filter(span => span.kind === 'heading'), ...spans.filter(span => span.kind !== 'heading')]) {
      if (room < 40) break;
      if (span.text.length <= room) kept.set(span.id, span);
      else { const cut = span.text.slice(0, room); const space = cut.lastIndexOf(' '); kept.set(span.id, { ...span, text: `${space > room * 0.6 ? cut.slice(0, space) : cut}…` }); }
      room -= span.text.length;
    }
  }
  return all.flatMap(span => kept.has(span.id) ? [kept.get(span.id)!] : []);
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
export async function createTeachTopic(request: CreateTopicRequest, provider: TeachProvider, userId?: string): Promise<TeachResponse> {
  const sources = sourcesOf(request.documents);
  if (request.mode === 'demo' && !request.sampleId) throw new ApiError(400, 'Choose a bundled sample for a sample session.', 'DEMO_ONLY');
  const planning = planSources(sources);
  const draft = await firstValid(async () => {
    const generated = await provider.rubric({ title: request.title, depth: request.depth, sources: planning });
    const plan = rubricSchema.parse(generated.data);
    if (!sources.length) return plan;
    // A stray citation should not discard a minute of Step 5 work: drop ids that are not in the notes, then
    // items left citing nothing, and keep the plan only if it still passes every rubric rule.
    const known = new Set(sources.map(span => span.id));
    const cited = plan.items.map(item => ({ ...item, sourceIds: item.sourceIds.filter(id => known.has(id)) })).filter(item => item.sourceIds.length);
    return rubricSchema.parse({ ...plan, items: cited });
  }, () => new ApiError(502, 'Step 5 could not build a study plan from these notes. Please retry.', 'INVALID_MODEL_OUTPUT'));
  const rubric = draft.items.map(item => ({ ...item, sourceIds: sources.length ? item.sourceIds : [], id: randomUUID() }));
  const topicId = randomUUID();
  const state: TeachState = { version: 1, topicId, scope: scopeFor(request.documents), title: request.title, depth: request.depth,
    sample: request.mode === 'demo', sampleId: request.sampleId, mode: 'teach', rubric, coreIdeas: draft.coreIdeas,
    credited: {}, revoked: [], transcript: [], pastProblems: [], styles: [], quizTurn: 0, revision: 0, pendingJudge: [], pendingBrief: false, lastFocus: null,
    ...(userId ? { userId } : {}) };
  return { topicId, stateToken: seal(state), progress: progress(state),
    message: { id: randomUUID(), role: 'assistant', text: 'Hi! I’m Stu. Teach me this topic in your own words. What should I know first?' },
    liveStep5: false };
}
/**
 * One teacher message. In teach mode only fast Stu runs here; the Step 5 Judge grades the message
 * afterwards through runJudgeTurn, so the reply never waits on the slower model. In re-learn mode the
 * reply depends on a checked brief, so the brief (Step 5) and Stu run in sequence.
 */
export async function runTeachTurn(request: TeachTurnRequest, provider: TeachProvider, _debugEnabled = false, userId?: string): Promise<TeachResponse> {
  const sources = sourcesOf(request.documents);
  const state = openTeachState(request.stateToken, request.topicId, request.documents, userId);
  if (request.revision <= state.revision) throw new ApiError(409, 'A newer message already changed this topic. Reload your saved session.', 'STALE_TURN');
  if (state.transcript.some(m => m.id === request.messageId || m.id === request.turnId)) throw new ApiError(409, 'This message has already been used. Retry with your latest saved session.', 'STALE_TURN');
  const user: Message = { id: request.messageId, role: 'user', text: request.text };
  const transcript = [...state.transcript, user];
  if (state.mode === 'relearn') return relearnReply(state, transcript, sources, provider, request.revision);
  const focus = state.lastFocus && validatedAnchor(state.lastFocus, transcript) ? state.lastFocus : genericFocus(user);
  const lessonText = [state.title, ...state.coreIdeas, ...state.rubric.map(item => item.requirement), ...sources.map(span => span.text),
    ...transcript.filter(message => message.role === 'user').map(message => message.text)].join(' ');
  const { stu } = await stuReply(provider, { depth: state.depth, mode: 'teach', transcript: transcript.slice(-20), lesson: lessonFor(state, sources, user.text),
    director: { focus: { type: focus.type, teacherMessageId: focus.teacherMessageId, anchorQuote: focus.anchorQuote, instruction: focus.instruction }, mistake: null },
    lastQuestionStyle: state.styles.at(-1) }, lessonText);
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
export async function runJudgeTurn(request: JudgeTurnRequest, provider: TeachProvider, debugEnabled = false, userId?: string): Promise<TeachResponse> {
  const sources = sourcesOf(request.documents);
  const state = openTeachState(request.stateToken, request.topicId, request.documents, userId);
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
