import test from 'node:test';
import assert from 'node:assert/strict';
import type { SourceSpan } from '../shared/types.js';
import { StepFunTeachProvider, callTimeoutMs } from './teach-provider.js';

const source: SourceSpan = { id: 'private-source-1', documentId: 'doc-1', pageIndex: 0, text: 'Private battery note: a closed path carries current.', quality: 'native' };
const rubric = { coreIdeas: ['circuit', 'current'], items: [
  { ideaIndex: 0, stage: 'cover', requirement: 'Name the circuit and its gist', sourceIds: [source.id] },
  { ideaIndex: 0, stage: 'explain', requirement: 'Explain how a closed circuit carries current', sourceIds: [source.id] },
  { ideaIndex: 1, stage: 'cover', requirement: 'Name current and give its gist', sourceIds: [source.id] },
  { ideaIndex: 1, stage: 'explain', requirement: 'Explain how current moves around a path', sourceIds: [source.id] },
  { ideaIndex: 0, stage: 'connect', requirement: 'Connect closed paths to current', sourceIds: [source.id] },
  { ideaIndex: 1, stage: 'connect', requirement: 'Contrast complete and broken paths', sourceIds: [source.id] },
] };
const response = (data: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] }), { status: 200 });

test('StepFun wire requests use separate judge and Stu models without sending private teaching data to Stu', async () => {
  const oldKey = process.env.STEPFUN_API_KEY;
  const oldJudge = process.env.STEPFUN_JUDGE_MODEL;
  const oldStu = process.env.STEPFUN_STU_MODEL;
  const oldModel = process.env.STEPFUN_MODEL;
  const originalFetch = globalThis.fetch;
  process.env.STEPFUN_API_KEY = 'private-test-key';
  delete process.env.STEPFUN_JUDGE_MODEL; delete process.env.STEPFUN_STU_MODEL; delete process.env.STEPFUN_MODEL;
  const bodies: Record<string, any>[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    if (bodies.length === 1) return response(rubric);
    if (bodies.length === 2) return response({ credits: [], revocations: [], problems: [],
      focus: { type: 'vague', teacherMessageId: 'teacher-1', anchorQuote: 'The path closes', instruction: 'ask_clarify' },
      mistake: null, allSatisfied: false, relearnBrief: null });
    return response({ text: 'Wait, what do you mean by the path closing?', questionStyle: 'literal' });
  }) as typeof fetch;
  try {
    const provider = new StepFunTeachProvider();
    assert.equal(provider.judgeModel, 'step-5-preview');
    assert.equal(provider.stuModel, 'step-3.7-flash');
    await provider.rubric({ title: 'Circuits', depth: 'big-picture', sources: [source] });
    await provider.judge({ title: 'Circuits', depth: 'big-picture', mode: 'teach', sources: [source], rubric,
      credits: {}, revoked: [], pastProblems: [], transcript: [{ id: 'teacher-1', role: 'user', text: 'The path closes' }], currentTeacherMessageId: 'teacher-1', quizTurn: 0 });
    await provider.stu({ depth: 'big-picture', mode: 'teach', transcript: [{ id: 'teacher-1', role: 'user', text: 'The path closes' }],
      director: { focus: { type: 'vague', teacherMessageId: 'teacher-1', anchorQuote: 'The path closes', instruction: 'ask_clarify' }, mistake: null } });
    assert.deepEqual(bodies.map(body => body.model), ['step-5-preview', 'step-5-preview', 'step-3.7-flash']);
    // The rubric gets more thought; per-turn Judge and Stu calls stay fast enough for the request budget.
    assert.deepEqual(bodies.map(body => body.reasoning_effort), ['low', 'low', 'low']);
    assert.ok(bodies.every(body => body.response_format.type === 'json_schema' && body.response_format.json_schema.strict === true));
    assert.ok(JSON.stringify(bodies[1]).includes(source.text));
    const stuPayload = JSON.stringify(bodies[2]);
    assert.ok(!stuPayload.includes(source.text));
    assert.ok(!stuPayload.includes('private-source-1'));
    assert.ok(!stuPayload.includes('Name the circuit'));
    assert.ok(!stuPayload.includes('coreIdeas'));
    assert.ok(!stuPayload.includes('credited'));
    assert.ok(!stuPayload.includes('private-test-key'));
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.STEPFUN_API_KEY; else process.env.STEPFUN_API_KEY = oldKey;
    if (oldJudge === undefined) delete process.env.STEPFUN_JUDGE_MODEL; else process.env.STEPFUN_JUDGE_MODEL = oldJudge;
    if (oldStu === undefined) delete process.env.STEPFUN_STU_MODEL; else process.env.STEPFUN_STU_MODEL = oldStu;
    if (oldModel === undefined) delete process.env.STEPFUN_MODEL; else process.env.STEPFUN_MODEL = oldModel;
  }
});

test('per-role StepFun timeouts fit inside the 180-second Vercel request budget', () => {
  const rubric = callTimeoutMs('rubric'); const judge = callTimeoutMs('judge'); const stu = callTimeoutMs('stu');
  assert.ok(rubric < 180_000);
  // One Judge call, one Stu call, and at most one Stu retry share a teaching request.
  assert.ok(judge + stu * 2 < 180_000);
  assert.ok(rubric > 75_000 && judge > 75_000);
});
