import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluationSchema, reportSchema, MAX_TURNS } from '../src/lib/models';
import { topics } from '../src/lib/topics';
import { appendTurn, buildReport, createSession, shouldEnd, updateStatuses } from '../src/lib/session';
import { demoEvaluation } from '../src/lib/demo';
import { evaluate, extractJson, parseEvaluation } from '../src/lib/evaluator';
import { publicTopic, sealRubric, unsealRubric } from '../src/lib/rubric-privacy';

const valid = {
  coveredConceptIds: ['goal'], partialConceptIds: [], missingConceptIds: ['gradient'], misconceptions: [], strengths: ['Clear start'],
  nextQuestion: 'How do we know which way to go?', questionPurpose: 'Probe gradient', shouldFinish: false, evaluatorConfidence: 'medium' as const,
};

describe('evaluator response', () => {
  it('extracts plain JSON and fenced JSON', () => {
    expect(extractJson(JSON.stringify(valid))).toEqual(valid);
    expect(extractJson(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``)).toEqual(valid);
  });
  it('validates the required schema', () => {
    expect(parseEvaluation(JSON.stringify(valid))).toEqual(valid);
    expect(() => evaluationSchema.parse({ ...valid, evaluatorConfidence: 'certain' })).toThrow();
    expect(() => parseEvaluation('{"nextQuestion":"Only one key"}')).toThrow();
  });
  it('retries invalid output once, then returns a usable fallback', async () => {
    const previousKey = process.env.STEPFUN_API_KEY;
    const previousDemo = process.env.DEMO_MODE;
    process.env.STEPFUN_API_KEY = 'test-only';
    process.env.DEMO_MODE = 'false';
    const mock = vi.fn().mockResolvedValue('not JSON');
    try {
      const session = createSession(topics[0], 'introductory', '', 'live');
      const result = await evaluate(session, 'It reduces error.', 'explain', mock);
      expect(mock).toHaveBeenCalledTimes(2);
      expect(result.nextQuestion.length).toBeGreaterThan(5);
      expect(result.evaluatorConfidence).toBe('medium');
    } finally {
      if (previousKey === undefined) delete process.env.STEPFUN_API_KEY; else process.env.STEPFUN_API_KEY = previousKey;
      if (previousDemo === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = previousDemo;
    }
  });
});

describe('session progression', () => {
  it('keeps private rubric criteria out of the browser topic', () => {
    const browserTopic = publicTopic(topics[0]);
    expect(JSON.stringify(browserTopic)).not.toContain('objective or loss measures');
    const token = sealRubric(topics[0].rubric);
    expect(unsealRubric(token)).toEqual(topics[0].rubric);
  });
  it('updates statuses from the latest cumulative evaluation', () => {
    const statuses = updateStatuses(topics[0], { ...valid, partialConceptIds: ['gradient'] });
    expect(statuses.goal).toBe('covered');
    expect(statuses.gradient).toBe('partial');
    expect(statuses.steps).toBe('missing');
  });
  it('ends at six turns and refuses a seventh', () => {
    let session = createSession(topics[0], 'introductory', '', 'demo');
    for (let i = 0; i < MAX_TURNS; i++) session = appendTurn(session, `Explanation ${i}`, valid);
    expect(shouldEnd(session)).toBe(true);
    expect(appendTurn(session, 'Extra', valid).turns).toHaveLength(MAX_TURNS);
  });
  it('keeps all final report scores within bounds', () => {
    let session = createSession(topics[0], 'introductory', '', 'demo');
    session = appendTurn(session, 'For example, a model predicts values and error tells us how wrong it is.', valid);
    const report = reportSchema.parse(buildReport(session));
    expect(Object.values(report.scores).every((score) => score >= 0 && score <= 100)).toBe(true);
    expect(report.initialExplanation).toContain('For example');
  });
  it('runs a three-explanation gradient-descent demo with coverage and a report', () => {
    let session = createSession(topics[0], 'introductory', '', 'demo');
    expect(demoEvaluation(session, '', 'simpler').nextQuestion).toContain('everyday example');
    const inputs = [
      'Gradient descent reduces the error in model predictions so the answer gets better over time.',
      'The gradient is the steepest uphill slope, so we move in the opposite direction downhill to lower the loss.',
      'For example, imagine walking down a hill. The learning rate is the step size. If steps are too large we overshoot, so we repeat smaller updates until we converge.',
    ];
    for (const input of inputs) {
      const evaluation = demoEvaluation(session, input);
      expect(evaluation.nextQuestion.endsWith('?')).toBe(true);
      session = appendTurn(session, input, evaluation);
    }
    expect(session.turns).toHaveLength(3);
    expect(Object.values(session.statuses).filter((x) => x === 'covered').length).toBeGreaterThan(2);
    const report = buildReport(session);
    expect(report.demonstrated.length).toBeGreaterThan(2);
    expect(report.scores.completeness).toBeGreaterThan(50);
  });
});

afterEach(() => vi.clearAllMocks());
