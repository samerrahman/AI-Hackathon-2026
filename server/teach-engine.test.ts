import test from 'node:test';
import assert from 'node:assert/strict';
import type { SourceSpan, StudyDocument } from '../shared/types.js';
import { ApiError } from './schema.js';
import { createTeachTopic, openTeachState, runTeachTurn } from './teach-engine.js';
import { DemoTeachProvider } from './teach-demo.js';
import type { JudgeInput, ModelResult, StuInput, TeachProvider } from './teach-provider.js';
import { rubricSchema, type Depth, type JudgeResult, type RubricDraft, type StuResult } from './teach-schema.js';

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
function judgeFor(input: JudgeInput, credits: string[] = [], revocations: string[] = [], problems: JudgeResult['problems'] = [], options: Partial<JudgeResult> = {}): JudgeResult {
  const message = input.transcript.at(-1)!;
  const quote = message.text.slice(0, 1200);
  const item = (id: string) => ({ rubricItemId: id, teacherMessageId: message.id, quote });
  return { credits: credits.map(item), revocations: revocations.map(item), problems,
    focus: { type: 'vague', teacherMessageId: message.id, anchorQuote: quote.slice(0, 160), instruction: 'ask_clarify' },
    mistake: null, allSatisfied: false, relearnBrief: null, ...options };
}
function provider(options: { judge?: (input: JudgeInput) => JudgeResult | Promise<JudgeResult>; stu?: (input: StuInput) => StuResult | Promise<StuResult>; rubric?: RubricDraft } = {}) {
  const calls: string[] = []; const stuInputs: StuInput[] = []; const judgeInputs: JudgeInput[] = [];
  const instance: TeachProvider = {
    judgeModel: 'step-5-preview', stuModel: 'step-3.7-flash',
    rubric: async () => { calls.push('rubric'); return model(options.rubric ?? draft); },
    judge: async input => { calls.push('judge'); judgeInputs.push(input); return model(options.judge ? await options.judge(input) : judgeFor(input)); },
    stu: async input => { calls.push('stu'); stuInputs.push(input); return model(options.stu ? await options.stu(input) : { text: 'Wait, how does that work in your example?', questionStyle: input.lastQuestionStyle === 'example' ? 'causal' : 'example' }, 'step-3.7-flash'); },
  };
  return { instance, calls, stuInputs, judgeInputs };
}
async function topic(instance: TeachProvider, depth: Depth = 'big-picture') {
  return createTeachTopic({ title: 'Simple circuits', depth, mode: 'live', documents: [document] }, instance);
}
function turn(initial: Awaited<ReturnType<typeof topic>>, text = statement, revision = 1, messageId = `user-${revision}`) {
  return { topicId: initial.topicId, stateToken: initial.stateToken, documents: [document], turnId: `turn-${revision}`, revision, messageId, text };
}

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

test('normal turn calls Judge then Stu; Stu receives no notes, rubric, sources, or credit state', async () => {
  const p = provider(); const created = await topic(p.instance);
  p.calls.length = 0;
  const result = await runTeachTurn(turn(created), p.instance);
  assert.deepEqual(p.calls, ['judge', 'stu']);
  assert.equal(result.liveStep5, true);
  assert.equal(result.message?.sourceIds, undefined);
  assert.deepEqual(Object.keys(p.stuInputs[0]).sort(), ['depth', 'director', 'lastQuestionStyle', 'mode', 'transcript']);
  const payload = JSON.stringify(p.stuInputs[0]);
  assert.ok(!payload.includes(source.text));
  assert.ok(!payload.includes('switch mechanism'));
  assert.ok(!payload.includes('rubric'));
  assert.ok(!payload.includes('credited'));
  assert.ok(!payload.includes('sourceIds'));
});

test('Judge failure prevents Stu; Stu failure keeps original state usable for retry', async () => {
  const brokenJudge = provider({ judge: async () => { throw new ApiError(502, 'Judge failed'); } });
  const created = await topic(brokenJudge.instance);
  brokenJudge.calls.length = 0;
  await assert.rejects(runTeachTurn(turn(created), brokenJudge.instance));
  assert.deepEqual(brokenJudge.calls, ['judge']);
  const itemId = openTeachState(created.stateToken, created.topicId, [document]).rubric[0].id;
  const brokenStu = provider({ judge: input => judgeFor(input, [itemId]), stu: async () => { throw new ApiError(502, 'Stu failed'); } });
  await assert.rejects(runTeachTurn(turn(created), brokenStu.instance));
  assert.equal(openTeachState(created.stateToken, created.topicId, [document]).credited[itemId], undefined);
  const fixed = provider({ judge: input => judgeFor(input, [itemId]) });
  const retry = await runTeachTurn(turn(created), fixed.instance);
  assert.equal(retry.progress.credited, 1);
});

test('only exact current teacher evidence credits; affirmations, fabricated quotes, assistant evidence and unknown IDs are dropped', async () => {
  const p = provider(); const created = await topic(p.instance);
  const itemId = openTeachState(created.stateToken, created.topicId, [document]).rubric[0].id;
  const exact = provider({ judge: input => judgeFor(input, [itemId]) });
  const credited = await runTeachTurn(turn(created), exact.instance);
  assert.equal(credited.progress.credited, 1);
  const fake = provider({ judge: input => judgeFor(input, [itemId], [], [], { credits: [
    { rubricItemId: itemId, teacherMessageId: input.currentTeacherMessageId, quote: 'an altered teacher quote' },
    { rubricItemId: 'unknown-rubric-id', teacherMessageId: input.currentTeacherMessageId, quote: input.transcript.at(-1)!.text },
    { rubricItemId: itemId, teacherMessageId: 'assistant-1', quote: input.transcript.at(-1)!.text },
  ] }) });
  assert.equal((await runTeachTurn(turn(created), fake.instance)).progress.credited, 0);
  const affirm = provider({ judge: input => judgeFor(input, [itemId]) });
  assert.equal((await runTeachTurn(turn(created, 'Yes, exactly'), affirm.instance)).progress.credited, 0);
});

test('contradiction revokes item credit and correction restores it; revocation wins within a turn', async () => {
  const p = provider(); const created = await topic(p.instance);
  const itemId = openTeachState(created.stateToken, created.topicId, [document]).rubric[0].id;
  const initial = await runTeachTurn(turn(created), provider({ judge: input => judgeFor(input, [itemId]) }).instance);
  const wrong = 'Actually an open switch still lets current flow through the broken path.';
  const revoking = provider({ judge: input => judgeFor(input, [itemId], [itemId], [{ type: 'wrong', description: 'Open switch claim is false', sourceIds: [source.id], affectedRubricItemIds: [itemId], teacherMessageId: input.currentTeacherMessageId, quote: input.transcript.at(-1)!.text }]) });
  const down = await runTeachTurn(turn(initial, wrong, 2, 'user-2'), revoking.instance);
  assert.equal(down.progress.credited, 0);
  const corrected = await runTeachTurn(turn(down, 'I correct that: an open switch breaks the path, so current stops flowing through the lamp.', 3, 'user-3'), provider({ judge: input => judgeFor(input, [itemId]) }).instance);
  assert.equal(corrected.progress.credited, 1);
});

test('ungrounded focus and mistake are replaced by a generic teacher-grounded direction', async () => {
  const p = provider(); const created = await topic(p.instance);
  const bad = provider({ judge: input => judgeFor(input, [], [], [], {
    focus: { type: 'missing_step', teacherMessageId: input.currentTeacherMessageId, anchorQuote: 'secret wavelength answer', instruction: 'ask_why' },
    mistake: { teacherMessageId: input.currentTeacherMessageId, anchorQuote: input.transcript.at(-1)!.text, restatement: 'The secret wavelength is violet.' },
  }) });
  await runTeachTurn(turn(created, 'Light moves through this thing, I think.'), bad.instance);
  const director = bad.stuInputs[0].director as { focus: { anchorQuote: string; instruction: string }; mistake: unknown };
  assert.equal(director.focus.instruction, 'ask_clarify');
  assert.equal(director.focus.anchorQuote, 'Light moves through this thing, I think.');
  assert.equal(director.mistake, null);
});

test('completion switches to re-learn with verified teacher wording, grounded brief, and one quiz question', async () => {
  const p = provider(); const created = await topic(p.instance);
  const ids = openTeachState(created.stateToken, created.topicId, [document]).rubric.map(item => item.id);
  const finishing = provider({ judge: input => judgeFor(input, ids, [], [], { relearnBrief: {
    teacherQuote: statement, accurateSummary: 'A complete circuit lets current flow, while an open switch breaks that path.',
    correction: '', quizFeedback: '', quizQuestion: 'What happens when the switch opens?', sourceIds: [source.id],
  } }), stu: input => ({ text: `You explained it as “${(input.director as { brief: { teacherQuote: string } }).brief.teacherQuote}”. A complete circuit carries current. What happens when the switch opens?`, questionStyle: 'example' }) });
  const result = await runTeachTurn(turn(created), finishing.instance);
  assert.equal(result.transition, true); assert.equal(result.progress.mode, 'relearn'); assert.equal(result.progress.percent, 100);
  assert.deepEqual(result.message?.sourceIds, [source.id]);
  assert.match(JSON.stringify(finishing.stuInputs[0].director), /teacherQuote/);
  assert.equal((finishing.stuInputs[0].director as { brief: { quizQuestion: string } }).brief.quizQuestion, 'What happens when the switch opens?');
});

test('debug response is sanitized and sample never claims a live Step 5 turn', async () => {
  const p = provider(); const created = await topic(p.instance);
  const id = openTeachState(created.stateToken, created.topicId, [document]).rubric[0].id;
  const debugProvider = provider({ judge: input => judgeFor(input, [id], [], [{ type: 'vague', description: 'Hidden rubric says the lamp must be luminous', sourceIds: [source.id], affectedRubricItemIds: [], teacherMessageId: input.currentTeacherMessageId, quote: input.transcript.at(-1)!.text }]) });
  const result = await runTeachTurn(turn(created), debugProvider.instance, true);
  assert.equal(result.debug?.credits[0].itemId, id);
  assert.ok(!JSON.stringify(result.debug).includes('Hidden rubric'));
  assert.ok(!JSON.stringify(result.debug).includes('switch mechanism'));
  assert.equal(result.debug?.models.judge, 'step-5-preview');
  const demo = new DemoTeachProvider('analysis');
  const demoTopic = await createTeachTopic({ title: 'Sample analysis', depth: 'big-picture', mode: 'demo', sampleId: 'analysis', documents: [document] }, demo);
  const demoTurn = await runTeachTurn(turn(demoTopic, 'A bounded sequence and convergent sequence are different ideas.'), demo);
  assert.equal(demoTurn.liveStep5, false);
  assert.equal(demoTopic.liveStep5, false);
});

test('Stu gets one quiet retry when he breaks his output rules', async () => {
  let attempts = 0;
  const p = provider({ stu: () => (++attempts === 1
    ? { text: 'Two questions? Really two?', questionStyle: 'literal' }
    : { text: 'Wait, how does that work in your example?', questionStyle: 'example' }) });
  const created = await topic(p.instance);
  p.calls.length = 0;
  const result = await runTeachTurn(turn(created), p.instance);
  assert.deepEqual(p.calls, ['judge', 'stu', 'stu']);
  assert.equal(result.message?.text, 'Wait, how does that work in your example?');
  const stillBroken = provider({ stu: () => ({ text: 'Two questions? Really two?', questionStyle: 'literal' }) });
  const again = await topic(stillBroken.instance);
  await assert.rejects(runTeachTurn(turn(again), stillBroken.instance), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_MODEL_OUTPUT');
});
