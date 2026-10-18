import test from 'node:test';
import assert from 'node:assert/strict';
import type { SourceSpan } from '../shared/types.js';
import { StepFunTeachProvider, callTimeoutMs } from './teach-provider.js';
import { ApiError } from './schema.js';
import { rubricSchema } from './teach-schema.js';

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
    if (bodies.length === 2) return response({ credits: [], revocations: [], problems: [] });
    // Stu answers in plain text, not JSON.
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Wait, what do you mean by the path closing?' } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const provider = new StepFunTeachProvider();
    assert.equal(provider.judgeModel, 'step-5-preview');
    assert.equal(provider.stuModel, 'step-3.7-flash');
    await provider.rubric({ title: 'Circuits', depth: 'big-picture', sources: [source] });
    await provider.judge({ title: 'Circuits', depth: 'big-picture', sources: [source], rubric: rubric.items.map((item, index) => ({ id: `item-${index}`, stage: item.stage, requirement: item.requirement, sourceIds: item.sourceIds })),
      creditedItemIds: [], pastProblems: [], transcript: [{ id: 'teacher-1', role: 'user', text: 'The path closes' }], pendingTeacherMessageIds: ['teacher-1'] });
    await provider.stu({ depth: 'big-picture', mode: 'teach', transcript: [{ id: 'teacher-1', role: 'user', text: 'The path closes' }],
      director: { focus: { type: 'vague', teacherMessageId: 'teacher-1', anchorQuote: 'The path closes', instruction: 'ask_clarify' }, mistake: null } });
    assert.deepEqual(bodies.map(body => body.model), ['step-5-preview', 'step-5-preview', 'step-3.7-flash']);
    // The rubric gets more thought; per-turn Judge and Stu calls stay fast enough for the request budget.
    assert.deepEqual(bodies.map(body => body.reasoning_effort), ['low', 'low', 'low']);
    assert.ok(bodies.slice(0, 2).every(body => body.response_format.type === 'json_schema' && body.response_format.json_schema.strict === true));
    assert.equal(bodies[2].response_format, undefined);
    // Streamed, so a long Step 5 generation keeps its connection busy.
    assert.ok(bodies.every(body => body.stream === true && body.stream_options?.include_usage === true));
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
  const rubric = callTimeoutMs('rubric'); const judge = callTimeoutMs('judge'); const brief = callTimeoutMs('brief'); const stu = callTimeoutMs('stu');
  // /api/topic and /api/judge each make one Step 5 call.
  assert.ok(rubric < 180_000 && judge < 180_000);
  // /api/teach: Stu plus one retry, or in re-learn mode the brief and then Stu plus one retry.
  assert.ok(brief + stu * 2 < 180_000);
  assert.ok(rubric > 75_000 && judge > 75_000);
});

test('cover gists may name chemicals but not numbers or equations', () => {
  const withCover = (requirement: string) => ({ ...rubric, items: [{ ...rubric.items[0], requirement }, ...rubric.items.slice(1)] });
  assert.equal(rubricSchema.safeParse(withCover('Name photosynthesis: plants turn CO2 and water into sugar')).success, true);
  assert.equal(rubricSchema.safeParse(withCover('Name the 3 stages of photosynthesis')).success, false);
  assert.equal(rubricSchema.safeParse(withCover('State that sugar = light + water')).success, false);
});

test('an invalid rubric gets one repair attempt with a content-free reason, then a clear error', async () => {
  const oldKey = process.env.STEPFUN_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.STEPFUN_API_KEY = 'private-test-key';
  const invalid = { ...rubric, items: [{ ...rubric.items[0], requirement: 'Name the 3 stages and the secret note' }, ...rubric.items.slice(1)] };
  const bodies: Record<string, any>[] = [];
  let replies = [invalid, rubric];
  globalThis.fetch = (async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return response(replies.shift()); }) as typeof fetch;
  const warn = console.warn; const logged: unknown[] = []; console.warn = (...args: unknown[]) => { logged.push(args); };
  try {
    const provider = new StepFunTeachProvider();
    const repaired = await provider.rubric({ title: 'Circuits', depth: 'big-picture', sources: [source] });
    assert.equal(bodies.length, 2);
    const repairNote = bodies[1].messages.at(-1).content as string;
    assert.match(repairNote, /rejected by the validator/);
    assert.match(repairNote, /Cover must contain gist only/);
    assert.ok(!repairNote.includes('secret note'));
    assert.equal(repaired.data.items[0].requirement, rubric.items[0].requirement);
    // Twice invalid: the error carries a diagnostic reason but no model or note text.
    bodies.length = 0; replies = [invalid, invalid];
    await assert.rejects(provider.rubric({ title: 'Circuits', depth: 'big-picture', sources: [source] }), (error: unknown) =>
      error instanceof ApiError && error.code === 'INVALID_MODEL_OUTPUT' && /schema: items\.0\.requirement/.test(error.detail ?? '') && !(error.detail ?? '').includes('secret'));
    assert.ok(!JSON.stringify(logged).includes('secret'));
  } finally {
    globalThis.fetch = originalFetch; console.warn = warn;
    if (oldKey === undefined) delete process.env.STEPFUN_API_KEY; else process.env.STEPFUN_API_KEY = oldKey;
  }
});
