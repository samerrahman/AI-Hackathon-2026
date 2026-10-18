import test from 'node:test';
import assert from 'node:assert/strict';
import type { SourceSpan, StudyDocument } from '../shared/types.js';
import { ApiError } from './schema.js';
import { createTeachTopic, openTeachState, runJudgeTurn, runTeachTurn } from './teach-engine.js';
import { DemoTeachProvider } from './teach-demo.js';
import type { BriefInput, JudgeInput, ModelResult, StuInput, TeachProvider } from './teach-provider.js';
import { createTopicSchema, rubricSchema, type Depth, type JudgeResult, type RelearnBrief, type RubricDraft, type StuResult } from './teach-schema.js';

process.env.SESSION_SECRET = 'teach-stu-test-only-secret';
const source: SourceSpan = { id: 'source-1', documentId: 'doc-1', pageIndex: 0,
  text: 'A circuit has a battery and a closed path. Current flows when the path is complete. An open switch breaks the path, so the lamp is off. A second branch can give current another path.', quality: 'native' };
const document: StudyDocument = { id: 'doc-1', name: 'Circuits.pdf', size: 200, hash: 'test', pageCount: 1, kind: 'pdf', spans: [source], warnings: [] };
const draft: RubricDraft = { coreIdeas: ['circuit', 'current'], items: [
  { ideaIndex: 0, stage: 'cover', requirement: 'Name a circuit as a path for current', sourceIds: [source.id] },
  { ideaIndex: 0, stage: 'explain', requirement: 'Explain how a closed circuit lets current flow', sourceIds: [source.id] },
  { ideaIndex: 1, stage: 'cover', requirement: 'Name current and give its gist', sourceIds: [source.id] },
  { ideaIndex: 1, stage: 'explain', requirement: 'Explain the switch mechanism and correct condition', sourceIds: [source.id] },
  { ideaIndex: 0, stage: 'connect', requirement: 'Connect circuit completeness with lamp behavior', sourceIds: [source.id] },
  { ideaIndex: 1, stage: 'connect', requirement: 'Contrast an open path and an alternate branch', sourceIds: [source.id] },
] };
const statement = 'A complete circuit lets current flow from the battery through the lamp, while an open switch breaks that path.';
function model<T>(data: T, name = 'step-5-preview'): ModelResult<T> { return { data, model: name, durationMs: 12 }; }
/** The newest teacher message waiting for grading (the transcript also holds Stu's replies). */
function pendingTeacher(input: JudgeInput) { return input.transcript.find(m => m.id === input.pendingTeacherMessageIds.at(-1))!; }
function judgeFor(input: JudgeInput, credits: string[] = [], revocations: string[] = [], problems: JudgeResult['problems'] = [], options: Partial<JudgeResult> = {}): JudgeResult {
  const message = pendingTeacher(input);
  const item = (id: string) => ({ rubricItemId: id, teacherMessageId: message.id, quote: message.text.slice(0, 1200) });
  return { credits: credits.map(item), revocations: revocations.map(item), problems, ...options };
}
const defaultBrief = (input: BriefInput): RelearnBrief => ({ teacherQuote: input.verifiedTeacherQuotes[0] ?? '',
  accurateSummary: 'A complete circuit lets current flow, while an open switch breaks that path.', correction: '', quizFeedback: '',
  quizQuestion: 'What happens when the switch opens?', sourceIds: input.sources.length ? [input.sources[0].id] : [] });
const alternate = (input: StuInput) => input.lastQuestionStyle === 'example' ? 'causal' as const : 'example' as const;
function provider(options: { judge?: (input: JudgeInput) => JudgeResult | Promise<JudgeResult>; brief?: (input: BriefInput) => RelearnBrief; stu?: (input: StuInput) => StuResult | Promise<StuResult>; rubric?: RubricDraft } = {}) {
  const calls: string[] = []; const stuInputs: StuInput[] = []; const judgeInputs: JudgeInput[] = []; const briefInputs: BriefInput[] = [];
  const instance: TeachProvider = {
    judgeModel: 'step-5-preview', stuModel: 'step-3.7-flash',
    rubric: async () => { calls.push('rubric'); return model(options.rubric ?? draft); },
    judge: async input => { calls.push('judge'); judgeInputs.push(input); return model(options.judge ? await options.judge(input) : judgeFor(input)); },
    brief: async input => { calls.push('brief'); briefInputs.push(input); return model((options.brief ?? defaultBrief)(input)); },
    stu: async input => { calls.push('stu'); stuInputs.push(input); return model(options.stu ? await options.stu(input) : { text: 'Wait, how does that work in your example?', questionStyle: alternate(input) }, 'step-3.7-flash'); },
  };
  return { instance, calls, stuInputs, judgeInputs, briefInputs };
}
type Provider = ReturnType<typeof provider>;
async function topic(instance: TeachProvider, depth: Depth = 'big-picture') {
  return createTeachTopic({ title: 'Simple circuits', depth, mode: 'live', documents: [document] }, instance);
}
function turn(previous: { topicId: string; stateToken: string }, text = statement, revision = 1, messageId = `user-${revision}`) {
  return { topicId: previous.topicId, stateToken: previous.stateToken, documents: [document], turnId: `turn-${revision}`, revision, messageId, text };
}
const grade = (previous: { topicId: string; stateToken: string }) => ({ topicId: previous.topicId, stateToken: previous.stateToken, documents: [document] });
/** A full teaching message: Stu's fast reply, then the background grading. */
async function teachAndGrade(previous: { topicId: string; stateToken: string }, p: Provider, text = statement, revision = 1, messageId = `user-${revision}`, debug = false) {
  const reply = await runTeachTurn(turn(previous, text, revision, messageId), p.instance);
  return runJudgeTurn(grade(reply), p.instance, debug);
}
const firstItem = (created: { topicId: string; stateToken: string }) => openTeachState(created.stateToken, created.topicId, [document]).rubric[0].id;

test('rubric depth contract keeps cover at gist level and allows deeper explain requirements', async () => {
  assert.equal(rubricSchema.safeParse(draft).success, true);
  assert.equal(rubricSchema.safeParse({ ...draft, items: [{ ...draft.items[0], requirement: 'State the exact equation I = V / R' }, ...draft.items.slice(1)] }).success, false);
  for (const depth of ['big-picture', 'exam-ready', 'expert'] as const) {
    const p = provider(); const created = await topic(p.instance, depth);
    assert.deepEqual(p.calls, ['rubric']);
    assert.equal(openTeachState(created.stateToken, created.topicId, [document]).depth, depth);
    assert.equal(created.progress.total, 6);
    assert.equal(created.liveStep5, false);
    assert.ok(!JSON.stringify(created).includes('switch mechanism'));
  }
  const exam = { ...draft, items: draft.items.map(item => item.stage === 'explain' ? { ...item, requirement: 'Explain precise mechanism, terminology, and conditions' } : item) };
  const expert = { ...draft, items: draft.items.map(item => item.stage === 'explain' ? { ...item, requirement: 'Explain mechanism, limitations, edge cases, and quantitative detail supported by notes' } : item) };
  assert.equal(rubricSchema.safeParse(exam).success, true);
  assert.equal(rubricSchema.safeParse(expert).success, true);
});

test('depth is fixed in authenticated state and cannot be changed by a turn request', async () => {
  const p = provider(); const created = await topic(p.instance, 'exam-ready');
  const changed = { ...turn(created), depth: 'expert' };
  await runTeachTurn(changed, p.instance);
  const result = openTeachState((await runTeachTurn({ ...turn(created), revision: 2, turnId: 'turn-2', messageId: 'user-2' }, p.instance)).stateToken, created.topicId, [document]);
  assert.equal(result.depth, 'exam-ready');
});

test('Stu replies first without the Judge; Stu never receives notes, rubric, sources, or credit state; the Judge grades afterwards', async () => {
  let itemId = '';
  const p = provider({ judge: input => judgeFor(input, [itemId]) }); const created = await topic(p.instance); itemId = firstItem(created);
  p.calls.length = 0;
  const reply = await runTeachTurn(turn(created), p.instance);
  // Two Stu samples race; the first valid one is used.
  assert.deepEqual(p.calls, ['stu', 'stu']);
  assert.equal(reply.judgePending, true);
  assert.equal(reply.progress.credited, 0);
  assert.equal(reply.message?.sourceIds, undefined);
  assert.deepEqual(Object.keys(p.stuInputs[0]).sort(), ['depth', 'director', 'lastQuestionStyle', 'mode', 'transcript']);
  const payload = JSON.stringify(p.stuInputs[0]);
  assert.ok(!payload.includes(source.text));
  assert.ok(!payload.includes('switch mechanism'));
  assert.ok(!payload.includes('rubric'));
  assert.ok(!payload.includes('credited'));
  assert.ok(!payload.includes('sourceIds'));
  const graded = await runJudgeTurn(grade(reply), p.instance);
  assert.deepEqual(p.calls, ['stu', 'stu', 'judge']);
  assert.deepEqual(p.judgeInputs[0].pendingTeacherMessageIds, ['user-1']);
  assert.deepEqual(graded.judgedMessageIds, ['user-1']);
  assert.equal(graded.progress.credited, 1);
  assert.equal(graded.liveStep5, true);
  // Nothing left to grade: the Judge is not called again.
  const idle = await runJudgeTurn(grade(graded), p.instance);
  assert.deepEqual(p.calls, ['stu', 'stu', 'judge']);
  assert.equal(idle.progress.credited, 1);
});

test('a failed grading keeps the message queued for the next grading; a failed Stu reply leaves the old state usable', async () => {
  let fail = true; let itemId = '';
  const p = provider({ judge: async input => { if (fail) throw new ApiError(502, 'Judge failed'); return judgeFor(input, [itemId]); } });
  const created = await topic(p.instance); itemId = firstItem(created);
  const reply = await runTeachTurn(turn(created), p.instance);
  await assert.rejects(runJudgeTurn(grade(reply), p.instance));
  fail = false;
  const reply2 = await runTeachTurn(turn(reply, 'A second branch can give current another path through the lamp circuit.', 2, 'user-2'), p.instance);
  const graded = await runJudgeTurn(grade(reply2), p.instance);
  assert.deepEqual(p.judgeInputs.at(-1)!.pendingTeacherMessageIds, ['user-1', 'user-2']);
  assert.equal(graded.progress.credited, 1);
  const brokenStu = provider({ stu: async () => { throw new ApiError(502, 'Stu failed'); } });
  await assert.rejects(runTeachTurn(turn(created), brokenStu.instance));
  const retry = await runTeachTurn(turn(created), provider().instance);
  assert.equal(retry.judgePending, true);
});

test('only exact evidence from the messages being graded credits; affirmations, fabricated quotes, assistant text, old messages and unknown IDs are dropped', async () => {
  let itemId = '';
  const exact = provider({ judge: input => judgeFor(input, [itemId]) }); const created = await topic(exact.instance); itemId = firstItem(created);
  const credited = await teachAndGrade(created, exact);
  assert.equal(credited.progress.credited, 1);
  const fake = provider({ judge: input => {
    const teacher = pendingTeacher(input); const assistant = input.transcript.find(m => m.role === 'assistant')!;
    return judgeFor(input, [], [], [], { credits: [
      { rubricItemId: itemId, teacherMessageId: teacher.id, quote: 'an altered teacher quote' },
      { rubricItemId: 'unknown-rubric-id', teacherMessageId: teacher.id, quote: teacher.text },
      { rubricItemId: itemId, teacherMessageId: assistant.id, quote: assistant.text },
    ] });
  } });
  assert.equal((await teachAndGrade(created, fake)).progress.credited, 0);
  const affirm = provider({ judge: input => judgeFor(input, [itemId]) });
  assert.equal((await teachAndGrade(created, affirm, 'Yes, exactly')).progress.credited, 0);
  // A message that was already graded cannot be re-used as new evidence.
  const secondItem = openTeachState(created.stateToken, created.topicId, [document]).rubric[1].id;
  const stale = provider({ judge: input => judgeFor(input, [], [], [], { credits: [{ rubricItemId: secondItem, teacherMessageId: 'user-1', quote: statement }] }) });
  assert.equal((await teachAndGrade(credited, stale, 'Current also needs a battery to push it around.', 2, 'user-2')).progress.credited, 1);
});

test('contradiction revokes credit, becomes Stu’s next question in the teacher’s words, and a correction restores it', async () => {
  let itemId = ''; let mode: 'credit' | 'revoke' = 'credit';
  const p = provider({ judge: input => mode === 'credit' ? judgeFor(input, [itemId]) : judgeFor(input, [itemId], [itemId], [{ type: 'wrong', description: 'Open switch claim is false',
    sourceIds: [source.id], affectedRubricItemIds: [itemId], teacherMessageId: pendingTeacher(input).id, quote: pendingTeacher(input).text }]) });
  const created = await topic(p.instance); itemId = firstItem(created);
  const initial = await teachAndGrade(created, p);
  assert.equal(initial.progress.credited, 1);
  mode = 'revoke';
  const wrong = 'Actually an open switch still lets current flow through the broken path.';
  const down = await teachAndGrade(initial, p, wrong, 2, 'user-2');
  assert.equal(down.progress.credited, 0);
  mode = 'credit';
  const correctedReply = await runTeachTurn(turn(down, 'I correct that: an open switch breaks the path, so current stops flowing through the lamp.', 3, 'user-3'), p.instance);
  const director = p.stuInputs.at(-1)!.director as { focus: { anchorQuote: string; instruction: string } };
  assert.equal(director.focus.instruction, 'ask_why');
  assert.equal(director.focus.anchorQuote, wrong);
  const corrected = await runJudgeTurn(grade(correctedReply), p.instance);
  assert.equal(corrected.progress.credited, 1);
});

test('an ungrounded problem quote never reaches Stu; he falls back to the newest teacher message', async () => {
  const p = provider({ judge: input => judgeFor(input, [], [], [{ type: 'missing_step', description: 'Missing wavelength', sourceIds: [], affectedRubricItemIds: [],
    teacherMessageId: pendingTeacher(input).id, quote: 'secret wavelength answer' }]) });
  const created = await topic(p.instance);
  const graded = await teachAndGrade(created, p, 'Light moves through this thing, I think.');
  await runTeachTurn(turn(graded, 'It goes around the loop.', 2, 'user-2'), p.instance);
  const director = p.stuInputs.at(-1)!.director as { focus: { anchorQuote: string; instruction: string }; mistake: unknown };
  assert.equal(director.focus.instruction, 'ask_clarify');
  assert.equal(director.focus.anchorQuote, 'It goes around the loop.');
  assert.equal(director.mistake, null);
  assert.ok(!JSON.stringify(p.stuInputs).includes('secret wavelength'));
});

test('completion switches to re-learn; a second grading call writes the verified brief and Stu’s teach-back; quiz answers run brief then Stu', async () => {
  let ids: string[] = [];
  const finishing = provider({ judge: input => judgeFor(input, ids), stu: input => (input.mode === 'relearn'
    ? { text: `You explained it as “${(input.director as { brief: { teacherQuote: string } }).brief.teacherQuote}”. A complete circuit carries current. What happens when the switch opens?`, questionStyle: alternate(input) }
    : { text: 'Wait, how does that work in your example?', questionStyle: alternate(input) }) });
  const created = await topic(finishing.instance); ids = openTeachState(created.stateToken, created.topicId, [document]).rubric.map(item => item.id);
  const reply = await runTeachTurn(turn(created), finishing.instance);
  const graded = await runJudgeTurn(grade(reply), finishing.instance);
  assert.equal(graded.transition, true); assert.equal(graded.next, 'brief'); assert.equal(graded.progress.mode, 'relearn'); assert.equal(graded.progress.percent, 100);
  assert.equal(graded.message, undefined);
  const teachBack = await runJudgeTurn(grade(graded), finishing.instance);
  assert.deepEqual(finishing.calls.slice(-3), ['brief', 'stu', 'stu']);
  assert.deepEqual(teachBack.message?.sourceIds, [source.id]);
  assert.ok(finishing.briefInputs[0].verifiedTeacherQuotes.includes(statement));
  assert.equal(finishing.briefInputs[0].transition, true);
  assert.equal((finishing.stuInputs.at(-1)!.director as { brief: { quizQuestion: string } }).brief.quizQuestion, 'What happens when the switch opens?');
  const quiz = await runTeachTurn(turn(teachBack, 'When the switch opens the path breaks, so no current flows.', 2, 'user-2'), finishing.instance);
  assert.deepEqual(finishing.calls.slice(-3), ['brief', 'stu', 'stu']);
  assert.equal(quiz.judgePending, undefined);
  assert.equal(finishing.briefInputs.at(-1)!.transition, false);
  assert.ok(quiz.message?.text);
});

test('debug response is sanitized and sample never claims a live Step 5 turn', async () => {
  let id = '';
  const debugProvider = provider({ judge: input => judgeFor(input, [id], [], [{ type: 'vague', description: 'Hidden rubric says the lamp must be luminous', sourceIds: [source.id], affectedRubricItemIds: [],
    teacherMessageId: pendingTeacher(input).id, quote: pendingTeacher(input).text }]) });
  const created = await topic(debugProvider.instance); id = firstItem(created);
  const result = await teachAndGrade(created, debugProvider, statement, 1, 'user-1', true);
  assert.equal(result.debug?.credits[0].itemId, id);
  assert.ok(!JSON.stringify(result.debug).includes('Hidden rubric'));
  assert.ok(!JSON.stringify(result.debug).includes('switch mechanism'));
  assert.equal(result.debug?.models.judge, 'step-5-preview');
  const demo = new DemoTeachProvider('analysis');
  const demoTopic = await createTeachTopic({ title: 'Sample analysis', depth: 'big-picture', mode: 'demo', sampleId: 'analysis', documents: [document] }, demo);
  const demoReply = await runTeachTurn(turn(demoTopic, 'A bounded sequence and convergent sequence are different ideas.'), demo);
  const demoGrade = await runJudgeTurn(grade(demoReply), demo);
  assert.equal(demoTopic.liveStep5, false);
  assert.equal(demoReply.liveStep5, false);
  assert.equal(demoGrade.liveStep5, false);
});

test('Stu races two samples and keeps the one that follows his rules', async () => {
  let attempts = 0;
  const p = provider({ stu: () => (++attempts === 1
    ? { text: 'One? Two? Three?', questionStyle: 'literal' }
    : { text: 'Wait, how does that work in your example?', questionStyle: 'example' }) });
  const created = await topic(p.instance);
  p.calls.length = 0;
  const result = await runTeachTurn(turn(created), p.instance);
  assert.deepEqual(p.calls, ['stu', 'stu']);
  assert.equal(result.message?.text, 'Wait, how does that work in your example?');
  const stillBroken = provider({ stu: () => ({ text: 'One? Two? Three?', questionStyle: 'literal' }) });
  const again = await topic(stillBroken.instance);
  await assert.rejects(runTeachTurn(turn(again), stillBroken.instance), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_MODEL_OUTPUT');
});

test('a topic can be taught without notes; the Judge grades from its own knowledge', async () => {
  assert.equal(createTopicSchema.safeParse({ title: 'Simple circuits', depth: 'big-picture', mode: 'live', documents: [] }).success, true);
  const noNotes: RubricDraft = { ...draft, items: draft.items.map(item => ({ ...item, sourceIds: [] })) };
  const p = provider({ rubric: noNotes, judge: input => { assert.deepEqual(input.sources, []); return judgeFor(input, []); } });
  const created = await createTeachTopic({ title: 'Simple circuits', depth: 'big-picture', mode: 'live', documents: [] }, p.instance);
  assert.equal(created.progress.total, 6);
  const reply = await runTeachTurn({ topicId: created.topicId, stateToken: created.stateToken, documents: [], turnId: 'turn-1', revision: 1, messageId: 'user-1', text: statement }, p.instance);
  await runJudgeTurn({ topicId: created.topicId, stateToken: reply.stateToken, documents: [] }, p.instance);
  assert.deepEqual(p.calls, ['rubric', 'stu', 'stu', 'judge']);
  assert.ok(reply.message?.text);
  // When notes exist, every rubric item must still cite them.
  await assert.rejects(createTeachTopic({ title: 'Simple circuits', depth: 'big-picture', mode: 'live', documents: [document] }, provider({ rubric: noNotes }).instance));
});
