import test from 'node:test';
import assert from 'node:assert/strict';
import type { Concept, SourceSpan, StudyDocument, TurnRequest } from '../shared/types.js';
import { runTurn } from './engine.js';
import { assessmentData, type StudyProvider } from './provider.js';
import { DemoProvider } from './demo.js';
import { decodeState, encodeState, remember } from './state.js';
import type { PrivateAssessment } from './schema.js';

process.env.SESSION_SECRET = 'personality-tests-only';
const source: SourceSpan = { id: 'source-two-gates', documentId: 'gates', pageIndex: 0, text: 'A glint is stable only when both amber and cobalt gates are open. One open gate alone is insufficient.', quality: 'native' };
const document: StudyDocument = { id: 'gates', hash: 'gates-hash', name: 'Gates', kind: 'text', size: source.text.length, pageCount: 1, spans: [source], warnings: [] };
const concept: Concept = { id: 'two-gates', title: 'Glint stability', description: 'Two necessary gates.', question: 'Why do I need both gates?', sourceIds: [source.id], status: 'not-discussed' };
const candidate = { candidate: 'So opening the amber gate alone keeps a glint stable?', correction: 'Both amber and cobalt gates must be open for a stable glint.', distinction: 'Cobalt is necessary too.', hint: 'What does the other gate contribute?', sourceIds: [source.id], quote: source.text };
const correct: PrivateAssessment = { interpretation: 'Explains both requirements.', strength: 'Both gates are needed for stability.', gap: '', judgment: 'correct', nextAction: 'advance', visibleText: 'Oh, both gates have a part to play.', spokenText: '', sourceIds: [source.id], challenge: null, correctionAccepted: false };
const request = (overrides: Partial<TurnRequest> = {}): TurnRequest => ({ sessionId: 'memory-session', turnId: crypto.randomUUID(), revision: 1, documents: [document], mode: 'live', concept, action: 'answer', text: 'Both the amber and cobalt gates have to be open.', history: [], settings: { challenges: 'standard' }, ...overrides });
const provider = (assessment: PrivateAssessment = correct, verdict: 'approved' | 'uncertain' = 'approved'): StudyProvider => ({ concepts: async () => ({ concepts: [] }), assess: async () => assessment, verify: async () => ({ verdict, reason: 'Fixture verification.', sourceIds: [source.id] }) });
async function challenge() {
  const state = decodeState(undefined, 'memory-session', [document]);
  state.substantialTurns = 2;
  return runTurn(request({ engineState: encodeState(state) }), provider({ ...correct, nextAction: 'challenge', challenge: candidate, visibleText: candidate.candidate }));
}

test('compact memory survives resume, excludes false candidates, and distinguishes source resolution from student correction', async () => {
  const opened = await challenge();
  const pendingState = decodeState(opened.engineState, 'memory-session', [document]);
  assert.equal(pendingState.memory?.[0].kind, 'explanation');
  assert.equal(pendingState.memory?.[0].statement, correct.strength);
  assert.ok(!JSON.stringify(pendingState.memory).includes(candidate.candidate));

  const skipped = await runTurn(request({ engineState: opened.engineState, action: 'skip', text: '' }), provider());
  const resumed = decodeState(skipped.engineState, 'memory-session', [document]);
  const receipt = resumed.memory?.find(item => item.kind === 'correction');
  assert.equal(receipt?.statement, candidate.correction);
  assert.equal(receipt?.studentCorrected, false);
  assert.deepEqual(receipt?.sourceIds, [source.id]);
  assert.ok(skipped.evidence.every(item => item.kind === 'review'));
  const context = assessmentData({ request: request(), state: resumed, sources: [source], challengeAllowed: false });
  assert.deepEqual(context.sessionMemory, resumed.memory);
  assert.ok(!JSON.stringify(context.sessionMemory).includes(candidate.candidate));
});

test('a corrected Stu owns the mix-up and retains the precise correction without an automatic quiz', async () => {
  const opened = await challenge();
  const resolved = await runTurn(request({ engineState: opened.engineState, text: 'No, cobalt must also be open.', revision: 2 }), provider({ ...correct, correctionAccepted: true }));
  assert.equal(resolved.visibleText, `Oh, I had that mixed up. ${candidate.correction}`);
  assert.equal(resolved.nextAction, 'advance');
  assert.equal(resolved.pendingChallenge, false);
  const memory = decodeState(resolved.engineState, 'memory-session', [document]).memory;
  assert.equal(memory?.find(item => item.kind === 'correction')?.studentCorrected, true);
});

test('rejected challenges never expose false text or replace it with an automatic examiner question', async () => {
  const state = decodeState(undefined, 'memory-session', [document]);
  state.substantialTurns = 2;
  const rejected = await runTurn(request({ engineState: encodeState(state) }), provider({ ...correct, nextAction: 'challenge', challenge: candidate, visibleText: candidate.candidate }, 'uncertain'));
  assert.equal(rejected.pendingChallenge, false);
  assert.ok(!rejected.visibleText.includes(candidate.candidate));
  assert.ok(!rejected.visibleText.includes('?'));
  assert.equal(decodeState(rejected.engineState, 'memory-session', [document]).memory?.length, 1);
});

test('memory stays bounded without truncating conditions and recent context stays small', () => {
  const state = decodeState(undefined, 'memory-session', [document]);
  for (let i = 0; i < 20; i++) remember(state, { conceptId: `idea-${i}`, kind: 'explanation', statement: `Statement ${i}: ${'a '.repeat(700)}only when both gates are open.`, sourceIds: [source.id], support: 'none' });
  assert.ok(state.memory!.length <= 8);
  assert.ok(JSON.stringify(state.memory).length <= 8_000);
  assert.ok(state.memory!.every(item => item.statement.endsWith('only when both gates are open.')));
  const history = Array.from({ length: 20 }, (_, i) => ({ id: `message-${i}`, role: 'user' as const, text: `Past turn ${i}` }));
  const data = assessmentData({ request: request({ history }), state, sources: [source], challengeAllowed: false });
  assert.deepEqual(data.history.map(item => item.id), history.slice(-8).map(item => item.id));
});

test('sample Stu paraphrases naturally without changing exact mathematical symbols or forcing a question', async () => {
  const span = { ...source, text: 'N may depend on ε, but once selected it must work for every later index n ≥ N.' };
  const quantifierConcept = { ...concept, title: 'Convergence & quantifiers' };
  const state = decodeState(undefined, 'memory-session', [document]);
  const assessment = await new DemoProvider('analysis').assess({ request: request({ concept: quantifierConcept, text: 'For every epsilon, the same N controls all later terms in the entire tail.' }), state, sources: [span], challengeAllowed: false });
  assert.equal(assessment.judgment, 'correct');
  assert.equal(assessment.nextAction, 'paraphrase');
  assert.ok(assessment.visibleText.includes('N may depend on ε'));
  assert.ok(assessment.visibleText.includes('n ≥ N'));
  assert.ok(!assessment.visibleText.includes('?'));
});
