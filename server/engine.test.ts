import test from 'node:test';
import assert from 'node:assert/strict';
import type { Concept, SourceSpan, StudyDocument, TurnRequest } from '../shared/types.js';
import { challengeIsAllowed, createConcepts, RevisionGate, runTurn, validateSources } from './engine.js';
import { decodeState, encodeState } from './state.js';
import { ApiError, turnRequestSchema, type PrivateAssessment } from './schema.js';
import { StepFunProvider, type StudyProvider } from './provider.js';

process.env.SESSION_SECRET = 'test-only-session-secret-never-used-in-production';
const source: SourceSpan = { id: 'fresh-p2-s1', documentId: 'fresh-doc', pageIndex: 1, text: 'A glint is stable only when both the amber switch and the cobalt switch are engaged. Either switch alone is insufficient.', quality: 'native' };
const document: StudyDocument = { id: 'fresh-doc', name: 'Unfamiliar optics.pdf', hash: 'test-hash', size: 1000, pageCount: 3, kind: 'pdf', spans: [source], warnings: [] };
const concept: Concept = { id: 'glint-concept', title: 'Glint stability', description: 'Two independent requirements.', question: 'Which switches must be engaged for stability, and why?', sourceIds: [source.id], status: 'not-discussed' };
const baseAssessment: PrivateAssessment = { interpretation: 'The student explains both switches.', strength: 'Both amber and cobalt switches are needed.', gap: '', judgment: 'correct', nextAction: 'advance', visibleText: 'You accounted for both requirements. We can move on.', spokenText: '', sourceIds: [source.id], challenge: null, correctionAccepted: false };
const candidate = { candidate: 'Would the amber switch alone make a glint stable?', correction: 'A glint is stable only when both the amber and cobalt switches are engaged.', distinction: 'The cobalt switch is also necessary.', sourceIds: [source.id], quote: source.text, hint: 'Which second switch does the passage require?' };
function request(overrides: Partial<TurnRequest> = {}): TurnRequest { return { sessionId: 'session-a', turnId: crypto.randomUUID(), revision: 1, documents: [document], mode: 'live', concept, history: [], text: 'Both amber and cobalt must be engaged for a stable glint.', action: 'answer', settings: { challenges: 'standard' }, ...overrides }; }
function fake(assessment = baseAssessment, verdict: 'approved' | 'uncertain' | 'rejected' = 'approved'): StudyProvider {
  return { concepts: async spans => ({ concepts: [{ title: 'Derived glint concept', description: spans[0].text, question: 'What makes the glint stable?', sourceIds: [spans[0].id] }] }), assess: async () => assessment, verify: async c => ({ verdict, reason: 'Test verifier decision.', sourceIds: c.sourceIds }) };
}
async function pending() {
  const state = decodeState(undefined, 'session-a', [document]);
  state.substantialTurns = 2;
  const req = request({ engineState: encodeState(state) });
  return runTurn(req, fake({ ...baseAssessment, nextAction: 'challenge', challenge: candidate, visibleText: candidate.candidate }));
}

test('a correct explanation advances without forced disagreement', async () => {
  const result = await runTurn(request({ settings: { challenges: 'off' } }), fake());
  assert.equal(result.status, 'explained-independently');
  assert.equal(result.nextAction, 'advance');
  assert.equal(result.pendingChallenge, false);
  assert.equal(result.evidence[0].kind, 'explained');
});
test('unfamiliar terms and reordered pages retain actual source IDs', async () => {
  const result = await createConcepts({ sessionId: 'fresh', documents: [document], mode: 'live' }, fake());
  assert.deepEqual(result.concepts[0].sourceIds, ['fresh-p2-s1']);
  assert.match(result.concepts[0].description, /amber switch/);
  assert.equal(source.pageIndex, 1);
});
test('challenge policy enforces spacing, gentle preference, and one unresolved challenge', () => {
  const state = decodeState(undefined, 'session-a', [document]);
  state.substantialTurns = 2;
  assert.equal(challengeIsAllowed(state, 'standard'), false);
  state.substantialTurns = 3;
  assert.equal(challengeIsAllowed(state, 'standard'), true);
  assert.equal(challengeIsAllowed(state, 'gentle'), false);
  assert.equal(challengeIsAllowed(state, 'off'), false);
  state.pending = { ...candidate, conceptId: concept.id, attempts: 0 };
  assert.equal(challengeIsAllowed(state, 'standard'), false);
});
test('a verified candidate is encrypted and an uncertain candidate is never shown', async () => {
  const result = await pending();
  assert.equal(result.label, 'Check my understanding');
  assert.equal(result.character, 'neutral');
  assert.equal(result.pendingChallenge, true);
  assert.equal(result.resolvedCorrection, undefined);
  assert.ok(!JSON.stringify(result).includes(candidate.correction));
  const state = decodeState(undefined, 'session-a', [document]); state.substantialTurns = 2;
  const rejected = await runTurn(request({ engineState: encodeState(state) }), fake({ ...baseAssessment, challenge: candidate, nextAction: 'challenge', visibleText: candidate.candidate }, 'uncertain'));
  assert.equal(rejected.pendingChallenge, false);
  assert.ok(!rejected.visibleText.includes(candidate.candidate));
});
test('faithful and deliberately false paraphrases have the same visible label and character cue', async () => {
  const faithful = await runTurn(request(), fake({ ...baseAssessment, nextAction: 'paraphrase', visibleText: 'Let me check that I understood: both switches are needed. Does that preserve your explanation?' }));
  const deliberate = await pending();
  assert.equal(faithful.label, deliberate.label);
  assert.equal(faithful.character, deliberate.character);
  assert.equal(faithful.character, 'neutral');
});
test('accepting a false claim produces a hint and then an accurate review, never positive evidence', async () => {
  const initial = await pending();
  const first = await runTurn(request({ engineState: initial.engineState, action: 'accept', text: 'That sounds right.', revision: 2 }), fake());
  assert.equal(first.pendingChallenge, true);
  assert.equal(first.nextAction, 'hint');
  assert.ok(first.evidence.every(e => e.kind !== 'explained' && e.kind !== 'corrected'));
  const second = await runTurn(request({ engineState: first.engineState, action: 'accept', text: 'Yes, amber alone.', revision: 3 }), fake());
  assert.equal(second.pendingChallenge, false);
  assert.equal(second.resolvedCorrection?.statement, candidate.correction);
  assert.equal(second.resolvedCorrection?.studentCorrected, false);
  assert.equal(second.status, 'needs-another-pass');
  assert.ok(second.evidence.every(e => e.kind === 'review' && !e.summary.includes(candidate.candidate)));
});
test('a student correction closes the loop with only the accurate takeaway', async () => {
  const initial = await pending();
  const result = await runTurn(request({ engineState: initial.engineState, text: 'No. Both switches are necessary; amber alone leaves cobalt absent.', revision: 2 }), fake({ ...baseAssessment, correctionAccepted: true }));
  assert.equal(result.pendingChallenge, false);
  assert.equal(result.resolvedCorrection?.studentCorrected, true);
  assert.equal(result.evidence[0].kind, 'corrected');
  assert.match(result.evidence[0].summary, /both the amber and cobalt/);
});
test('skip, end, direct explanation and concept change resolve even when provider is unavailable', async () => {
  const broken: StudyProvider = { ...fake(), assess: async () => { throw new Error('Network down'); } };
  for (const action of ['skip', 'end', 'explain', 'start'] as const) {
    const initial = await pending();
    const result = await runTurn(request({ engineState: initial.engineState, action, concept: action === 'start' ? { ...concept, id: 'next-concept' } : concept }), broken);
    assert.equal(result.pendingChallenge, false);
    assert.match(result.visibleText, /both the amber and cobalt/);
    assert.ok(result.resolvedCorrection);
  }
});
test('source references, quotes, and selections cannot escape their source collection', async () => {
  await assert.rejects(runTurn(request(), fake({ ...baseAssessment, sourceIds: ['made-up-id'] })), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_SOURCE');
  await assert.rejects(runTurn(request({ selection: { documentId: document.id, pageIndex: 1, text: 'a fabricated selection', spanIds: [source.id] } }), fake()), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_SELECTION');
  assert.throws(() => validateSources([{ ...document, spans: [{ ...source, documentId: 'other-course' }] }]), ApiError);
  const state = decodeState(undefined, 'session-a', [document]); state.substantialTurns = 2;
  const result = await runTurn(request({ engineState: encodeState(state) }), fake({ ...baseAssessment, nextAction: 'challenge', challenge: { ...candidate, quote: 'The lecture says amber alone is sufficient.' } }));
  assert.equal(result.pendingChallenge, false);
});
test('opaque state rejects tampering and a changed document, while resume preserves a pending correction', async () => {
  const initial = await pending();
  assert.equal(decodeState(initial.engineState, 'session-a', [document]).pending?.correction, candidate.correction);
  assert.throws(() => decodeState(initial.engineState, 'different-session', [document]), ApiError);
  assert.throws(() => decodeState(initial.engineState.slice(0, -8) + 'AAAAAAAA', 'session-a', [document]), ApiError);
  assert.throws(() => decodeState(initial.engineState, 'session-a', [{ ...document, spans: [{ ...source, text: 'A changed claim whose support no longer matches the saved challenge.' }] }]), ApiError);
});
test('a real selection without PDF geometry retrieves its matching source, not an unrelated concept passage', async () => {
  const selected: SourceSpan = { ...source, id: 'fresh-p3-s1', pageIndex: 2, text: 'A prism carries two polarized channels, labeled bronze and silver. Neither channel is the amber switch.' };
  const docs = [{ ...document, spans: [source, selected] }];
  const provider: StudyProvider = { ...fake(), assess: async context => {
    assert.deepEqual(context.request.selection?.spanIds, [selected.id]);
    assert.equal(context.sources[0].id, selected.id);
    assert.ok(context.sources.some(span => span.id === selected.id));
    return { ...baseAssessment, judgment: 'not-assessed', nextAction: 'explain', sourceIds: [selected.id], visibleText: 'This paragraph names the two prism channels.' };
  } };
  const result = await runTurn(request({ documents: docs, action: 'explain', selection: { text: 'two polarized channels, labeled bronze and silver', documentId: document.id, pageIndex: 2, spanIds: [] } }), provider);
  assert.deepEqual(result.sourceIds, [selected.id]);
});
test('whitespace-only selections are rejected before source matching can loop', async () => {
  const emptySelection = request({ selection: { text: ' \n\t ', documentId: document.id, pageIndex: source.pageIndex, spanIds: [source.id] } });
  assert.equal(turnRequestSchema.safeParse(emptySelection).success, false);
  await assert.rejects(runTurn(emptySelection, fake()), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_SELECTION');
});
test('a late completion cannot commit after a newer correction', () => {
  const gate = new RevisionGate();
  const oldTurn = request({ revision: 3 });
  const correction = request({ revision: 4 });
  gate.begin(oldTurn); gate.begin(correction);
  assert.throws(() => gate.assertCurrent(oldTurn), (error: unknown) => error instanceof ApiError && error.code === 'STALE_TURN');
  assert.doesNotThrow(() => gate.assertCurrent(correction));
});
test('malformed provider output is rejected and request data is sent under an untrusted-data policy', async () => {
  const original = globalThis.fetch;
  let sent = '';
  globalThis.fetch = (async (_input, init) => { sent = String(init?.body); return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"wrong":"shape"}' } }] }), { status: 200 }); }) as typeof fetch;
  try {
    await assert.rejects(new StepFunProvider('test-key').concepts([source]), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_MODEL_OUTPUT');
    assert.match(sent, /UNTRUSTED STUDY DATA/);
    assert.match(sent, /fresh-p2-s1/);
    assert.ok(!sent.includes('test-key'));
  } finally { globalThis.fetch = original; }
});
