import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { StudyDocument, TurnRequest } from '../shared/types.js';
import { nativeLines, spansFromLines } from '../src/lib/pdf-spans.js';
import { DemoProvider } from './demo.js';
import { createConcepts, runTurn } from './engine.js';
import { decodeState, encodeState } from './state.js';

process.env.SESSION_SECRET = 'test-only-demo-secret';
async function ingest(name: string): Promise<StudyDocument> {
  const bytes = await readFile(`public/examples/${name}.pdf`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const id = `doc-${hash.slice(0, 24)}`;
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await loading.promise;
  const spans = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const content = await page.getTextContent();
    spans.push(...spansFromLines(nativeLines(content.items.filter((item): item is TextItem => 'str' in item), content.styles, page.getViewport({ scale: 1 })), id, i));
  }
  const document: StudyDocument = { id, name: `${name}.pdf`, hash, size: bytes.length, pageCount: pdf.numPages, kind: 'pdf', spans, warnings: [] };
  await loading.destroy();
  return document;
}
test('demo corrections require a complete reviewed distinction, never topic words inside a false acceptance', async () => {
  const analysis = await ingest('Sequences_and_Convergence');
  const research = await ingest('Experiments_and_Causal_Claims');
  const cases = [
    { sampleId: 'analysis' as const, index: 0, answer: 'Boundedness keeps terms in a finite interval, but a bounded sequence can oscillate and not converge.', correction: 'No. A bounded sequence can alternate between minus one and one, so boundedness does not imply convergence.', wrong: ['No, a bounded sequence cannot oscillate and must converge.'] },
    { sampleId: 'analysis' as const, index: 1, answer: 'For every epsilon, the same N controls all later terms in the entire tail.', correction: 'N can depend on epsilon, but not on the later index n.', wrong: ['No, N can depend on every later n after epsilon.', 'n can depend on epsilon, but not on the later index N.'] },
    { sampleId: 'analysis' as const, index: 2, answer: 'A bounded monotone real sequence converges because monotonicity prevents oscillation.', correction: 'No, the theorem requires both boundedness and monotonicity.', wrong: ['Yes, boundedness alone is enough; monotonicity is not needed.', 'The theorem requires both boundedness and monotonicity, but monotonicity is optional.'] },
    { sampleId: 'analysis' as const, index: 3, answer: 'A convergent subsequence does not imply that the whole original sequence converges.', correction: 'Only a subsequence is guaranteed to converge, not the whole sequence.', wrong: ['No, the whole original sequence must converge if a subsequence does.'] },
    { sampleId: 'research' as const, index: 0, answer: 'Sampling selects who enters the study; assignment decides which treatment participants receive.', correction: 'No, assignment alone does not make a volunteer sample representative.', wrong: ['No, assignment makes volunteers representative.', 'Random assignment does not guarantee a representative sample, except it guarantees volunteers are representative.'] },
    { sampleId: 'research' as const, index: 1, answer: 'Motivation can influence both app use and grades.', correction: 'Association alone does not establish causation.', wrong: ['No, motivation proves both app use causes grades.'] },
  ];
  for (const fixture of cases) {
    const document = fixture.sampleId === 'analysis' ? analysis : research;
    const provider = new DemoProvider(fixture.sampleId);
    const base = { sessionId: `correction-${fixture.sampleId}-${fixture.index}`, documents: [document], mode: 'demo' as const, sampleId: fixture.sampleId };
    const { concepts } = await createConcepts(base, provider);
    const concept = concepts[fixture.index];
    const state = decodeState(undefined, base.sessionId, base.documents);
    state.substantialTurns = 2;
    const request: TurnRequest = { ...base, concept, turnId: 'candidate', revision: 1, history: [], text: fixture.answer, action: 'answer', settings: { challenges: 'standard' }, engineState: encodeState(state) };
    const candidate = await runTurn(request, provider);
    assert.equal(candidate.pendingChallenge, true, concept.title);
    for (const wrong of fixture.wrong) {
      const answer = await runTurn({ ...request, turnId: 'false-acceptance', revision: 2, engineState: candidate.engineState, text: wrong }, provider);
      assert.equal(answer.pendingChallenge, true, wrong);
      assert.equal(answer.nextAction, 'hint', wrong);
      assert.ok(answer.evidence.every(e => e.kind !== 'corrected' && e.kind !== 'explained'), wrong);
      const recap = await runTurn({ ...request, turnId: 'resolve', revision: 3, engineState: answer.engineState, action: 'end', text: '' }, provider);
      assert.equal(recap.resolvedCorrection?.studentCorrected, false, wrong);
      assert.ok(recap.evidence.every(e => e.kind === 'review'), wrong);
    }
    const corrected = await runTurn({ ...request, turnId: 'real-correction', revision: 2, engineState: candidate.engineState, text: fixture.correction }, provider);
    assert.equal(corrected.resolvedCorrection?.studentCorrected, true, fixture.correction);
    assert.equal(corrected.evidence[0].kind, 'corrected');
  }
});
for (const sampleId of ['analysis', 'research'] as const) {
  test(`${sampleId}: actual PDF extraction, source-grounded outline, challenge and accurate resolution`, async () => {
    const document = await ingest(sampleId === 'analysis' ? 'Sequences_and_Convergence' : 'Experiments_and_Causal_Claims');
    const provider = new DemoProvider(sampleId);
    const request = { sessionId: `demo-${sampleId}`, documents: [document], mode: 'demo' as const, sampleId };
    const outline = await createConcepts(request, provider);
    assert.equal(outline.concepts.length, sampleId === 'analysis' ? 4 : 2);
    for (const concept of outline.concepts) assert.ok(concept.sourceIds.every(id => document.spans.some(s => s.id === id)));
    const concept = outline.concepts[0];
    const answer = sampleId === 'analysis' ? 'Bounded terms stay in a fixed finite interval, but they can oscillate and not converge.' : 'Sampling selects who enters the study; assignment decides which treatment the participants receive.';
    let engineState: string | undefined;
    let result;
    for (let i = 0; i < 3; i++) {
      const turn: TurnRequest = { ...request, turnId: `answer-${i}`, revision: i, concept, history: [], text: answer, action: 'answer', settings: { challenges: 'standard' }, engineState };
      result = await runTurn(turn, provider);
      engineState = result.engineState;
    }
    assert.equal(result?.pendingChallenge, true);
    const closed = await runTurn({ ...request, turnId: 'end', revision: 5, concept, history: [], text: '', action: 'end', settings: { challenges: 'standard' }, engineState }, provider);
    assert.equal(closed.pendingChallenge, false);
    assert.ok(closed.resolvedCorrection?.statement);
    assert.ok(closed.sourceIds.every(id => document.spans.some(s => s.id === id)));
    assert.equal(closed.evidence[0].kind, 'review');
  });
}
