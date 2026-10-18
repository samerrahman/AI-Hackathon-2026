import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { SourceSpan } from '../shared/types.js';
import { validateSources, requireReferences } from './engine.js';
import { scopeFor, stateKey } from './state.js';
import { ApiError } from './schema.js';
import { rubricSchema, judgeSchema, stuSchema, type CreateTopicRequest, type Depth, type JudgeResult, type TeachMode, type TeachTurnRequest } from './teach-schema.js';
import type { ModelResult, TeachProvider, StuInput } from './teach-provider.js';

type Message = { id: string; role: 'user' | 'assistant'; text: string };
type Evidence = { rubricItemId: string; teacherMessageId: string; quote: string };
type Item = { id: string; ideaIndex: number; stage: 'cover' | 'explain' | 'connect'; requirement: string; sourceIds: string[] };
export interface TeachState {
  version: 1; topicId: string; scope: string; title: string; depth: Depth; sample: boolean; sampleId?: 'analysis' | 'research';
  mode: TeachMode; rubric: Item[]; coreIdeas: string[]; credited: Record<string, Evidence>; revoked: Evidence[];
  transcript: Message[]; pastProblems: { type: string; description: string }[]; styles: string[]; quizTurn: number; revision: number;
}
export interface SafeDebug {
  credits: { itemId: string; quote: string }[]; revocations: { itemId: string; quote: string }[];
  problems: { type: string; description: string }[]; focus: { type: string; anchorQuote: string; instruction: string };
  mistakeAccepted: boolean; models: { judge: string; stu: string }; durationMs: { judge: number; stu: number };
}
export interface TeachResponse {
  topicId: string; stateToken: string; progress: { total: number; credited: number; percent: number; mode: TeachMode };
  message?: Message & { sourceIds?: string[] }; transition?: boolean; liveStep5: boolean; debug?: SafeDebug;
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
function relevantJudgeSources(all: SourceSpan[], state: TeachState, latest: string): SourceSpan[] {
  const needed = new Set(state.rubric.flatMap(item => item.sourceIds));
  const terms = new Set(latest.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
  const ranked = all.map(span => ({ span, score: (needed.has(span.id) ? 10 : 0) + [...terms].filter(term => span.text.toLowerCase().includes(term)).length }))
    .sort((a, b) => b.score - a.score);
  let chars = 0;
  return ranked.filter(({ span }, index) => { if (index >= 50 || chars + span.text.length > 65_000) return false; chars += span.text.length; return true; }).map(x => x.span);
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
function safeFocus(judge: JudgeResult, messages: Message[]) {
  if (judge.focus && validatedAnchor(judge.focus, messages)) return judge.focus;
  const latest = [...messages].reverse().find(m => m.role === 'user')!;
  return { type: 'vague' as const, teacherMessageId: latest.id, anchorQuote: latest.text.slice(0, 160), instruction: 'ask_clarify' as const };
}
function safeMistake(judge: JudgeResult, messages: Message[]) {
  const mistake = judge.mistake;
  if (!mistake || !validatedAnchor(mistake, messages) || mistake.restatement === mistake.anchorQuote) return null;
  const anchorWords = new Set((mistake.anchorQuote.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []));
  const generic = new Set(['would', 'could', 'does', 'that', 'this', 'then', 'only', 'just', 'maybe', 'mean', 'means', 'like', 'right', 'what', 'when', 'where', 'always', 'never', 'really', 'because', 'about', 'your', 'said', 'saying', 'think', 'understand', 'the', 'and', 'for', 'are', 'was', 'were', 'you', 'can', 'not', 'but', 'all', 'any', 'one', 'two', 'did', 'had', 'has', 'have', 'is', 'it', 'or', 'to', 'of', 'in', 'on', 'at', 'as', 'if', 'be', 'do', 'so', 'we', 'he', 'she', 'they', 'them', 'me', 'my']);
  const newFacts = (mistake.restatement.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(word => !anchorWords.has(word) && !generic.has(word));
  return newFacts.length ? null : mistake;
}
function safeProblems(judge: JudgeResult, all: SourceSpan[]) {
  const validIds = new Set(all.map(s => s.id));
  return judge.problems.filter(problem => problem.sourceIds.every(id => validIds.has(id)));
}
const problemDescriptions: Record<string, string> = {
  wrong: 'A factual claim needs correction.', vague: 'The explanation needs a more specific statement.',
  missing_step: 'A reasoning step is missing.', undefined_term: 'A term needs defining.', off_topic: 'The explanation moved away from the topic.',
};
function validateStuText(text: string, mode: TeachMode) {
  if ((text.match(/\?/g) || []).length !== 1 || text.length > (mode === 'teach' ? 450 : 900)) throw new ApiError(502, 'Stu returned an incomplete response. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT');
  if (mode === 'teach' && text.split(/[.!?]+/).filter(Boolean).length > 3) throw new ApiError(502, 'Stu returned an overlong response. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT');
}
function verifiedRelearnBrief(judge: JudgeResult, state: TeachState, sources: SourceSpan[]) {
  const brief = judge.relearnBrief;
  if (!brief) throw new ApiError(502, 'The re-learn brief was incomplete. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT');
  requireReferences(brief.sourceIds, sources);
  if (!Object.values(state.credited).some(e => e.quote.includes(brief.teacherQuote))) throw new ApiError(502, 'The re-learn brief lacked verified teacher wording. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT');
  if (state.pastProblems.some(p => p.type === 'wrong') && !brief.correction.trim()) throw new ApiError(502, 'The re-learn brief omitted a needed correction. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT');
  return brief;
}
export async function createTeachTopic(request: CreateTopicRequest, provider: TeachProvider): Promise<TeachResponse> {
  const sources = validateSources(request.documents);
  if (request.mode === 'demo' && !request.sampleId) throw new ApiError(400, 'Choose a bundled sample for a sample session.', 'DEMO_ONLY');
  const generated = await provider.rubric({ title: request.title, depth: request.depth, sources });
  const draft = rubricSchema.parse(generated.data);
  const rubric = draft.items.map(item => { requireReferences(item.sourceIds, sources); return { ...item, id: randomUUID() }; });
  const topicId = randomUUID();
  const state: TeachState = { version: 1, topicId, scope: scopeFor(request.documents), title: request.title, depth: request.depth,
    sample: request.mode === 'demo', sampleId: request.sampleId, mode: 'teach', rubric, coreIdeas: draft.coreIdeas,
    credited: {}, revoked: [], transcript: [], pastProblems: [], styles: [], quizTurn: 0, revision: 0 };
  return { topicId, stateToken: seal(state), progress: progress(state),
    message: { id: randomUUID(), role: 'assistant', text: 'Hi! I’m Stu. Teach me this topic in your own words. What should I know first?' },
    liveStep5: false };
}
export async function runTeachTurn(request: TeachTurnRequest, provider: TeachProvider, debugEnabled = false): Promise<TeachResponse> {
  const sources = validateSources(request.documents);
  const state = openTeachState(request.stateToken, request.topicId, request.documents);
  if (request.revision <= state.revision) throw new ApiError(409, 'A newer message already changed this topic. Reload your saved session.', 'STALE_TURN');
  if (state.transcript.some(m => m.id === request.messageId || m.id === request.turnId)) throw new ApiError(409, 'This message has already been used. Retry with your latest saved session.', 'STALE_TURN');
  const user: Message = { id: request.messageId, role: 'user', text: request.text };
  const transcript = [...state.transcript, user];
  const judgeCall = await provider.judge({ title: state.title, depth: state.depth, mode: state.mode,
    sources: relevantJudgeSources(sources, state, request.text), rubric: state.rubric, credits: state.credited,
    revoked: state.revoked.slice(-15), pastProblems: state.pastProblems.slice(-12), transcript: transcript.slice(-24),
    currentTeacherMessageId: user.id, quizTurn: state.quizTurn });
  const judge = judgeSchema.parse(judgeCall.data);
  const proposed: TeachState = { ...state, credited: { ...state.credited }, revoked: [...state.revoked],
    transcript, pastProblems: [...state.pastProblems], styles: [...state.styles], revision: request.revision };
  const itemIds = new Set(state.rubric.map(item => item.id));
  const usedCredits = new Set<string>(); const usedRevokes = new Set<string>();
  const validCredits = judge.credits.filter(e => e.teacherMessageId === user.id && validEvidence(e, transcript, itemIds, usedCredits));
  const validRevokes = judge.revocations.filter(e => e.teacherMessageId === user.id && validEvidence(e, transcript, itemIds, usedRevokes));
  const problems = safeProblems(judge, sources).filter(problem => validatedAnchor({ teacherMessageId: problem.teacherMessageId, anchorQuote: problem.quote }, transcript));
  const blocked = new Set(problems.filter(problem => problem.type === 'wrong').flatMap(problem => problem.affectedRubricItemIds.filter(id => itemIds.has(id))));
  for (const credit of validCredits) if (!blocked.has(credit.rubricItemId)) proposed.credited[credit.rubricItemId] = credit;
  for (const revoke of validRevokes) { delete proposed.credited[revoke.rubricItemId]; proposed.revoked.push(revoke); }
  for (const problem of problems.filter(problem => problem.type === 'wrong')) for (const id of problem.affectedRubricItemIds) {
    if (proposed.credited[id]) { delete proposed.credited[id]; proposed.revoked.push({ rubricItemId: id, teacherMessageId: problem.teacherMessageId, quote: problem.quote }); }
  }
  proposed.pastProblems.push(...problems.filter(p => p.type === 'wrong').map(p => ({ type: p.type, description: p.description })));
  proposed.pastProblems = proposed.pastProblems.slice(-15);
  const focus = safeFocus(judge, transcript);
  const mistake = safeMistake(judge, transcript);
  const completed = Object.keys(proposed.credited).length === proposed.rubric.length && !problems.some(p => p.type === 'wrong');
  const transition = state.mode === 'teach' && completed;
  if (transition) proposed.mode = 'relearn';
  const brief = proposed.mode === 'relearn' ? verifiedRelearnBrief(judge, proposed, sources) : null;
  const director: StuInput['director'] = proposed.mode === 'teach'
    ? { focus: { type: focus.type, teacherMessageId: focus.teacherMessageId, anchorQuote: focus.anchorQuote, instruction: focus.instruction },
        mistake: mistake ? { teacherMessageId: mistake.teacherMessageId, anchorQuote: mistake.anchorQuote, restatement: mistake.restatement } : null }
    : { brief, quizTurn: proposed.quizTurn, transition };
  const stuCall = await provider.stu({ depth: state.depth, mode: proposed.mode, transcript: transcript.slice(-20), director,
    lastQuestionStyle: state.styles.at(-1) });
  const stu = stuSchema.parse(stuCall.data);
  validateStuText(stu.text, proposed.mode);
  if (state.styles.at(-1) === stu.questionStyle) throw new ApiError(502, 'Stu repeated a question style. Your message is safe; retry.', 'INVALID_MODEL_OUTPUT');
  proposed.styles.push(stu.questionStyle);
  if (proposed.mode === 'relearn') proposed.quizTurn++;
  const assistant: Message = { id: randomUUID(), role: 'assistant', text: stu.text };
  proposed.transcript.push(assistant);
  proposed.transcript = proposed.transcript.slice(-60);
  const debug: SafeDebug | undefined = debugEnabled ? {
    credits: validCredits.filter(e => proposed.credited[e.rubricItemId]?.teacherMessageId === e.teacherMessageId).map(e => ({ itemId: e.rubricItemId, quote: e.quote })),
    revocations: proposed.revoked.slice(state.revoked.length).map(e => ({ itemId: e.rubricItemId, quote: e.quote })),
    problems: problems.map(p => ({ type: p.type, description: problemDescriptions[p.type] })),
    focus: { type: focus.type, anchorQuote: focus.anchorQuote, instruction: focus.instruction },
    mistakeAccepted: Boolean(mistake), models: { judge: judgeCall.model, stu: stuCall.model },
    durationMs: { judge: judgeCall.durationMs, stu: stuCall.durationMs },
  } : undefined;
  return { topicId: state.topicId, stateToken: seal(proposed), progress: progress(proposed),
    message: { ...assistant, ...(brief ? { sourceIds: brief.sourceIds } : {}) }, transition,
    liveStep5: !state.sample && judgeCall.model === 'step-5-preview' && stuCall.model === provider.stuModel,
    ...(debug ? { debug } : {}) };
}
