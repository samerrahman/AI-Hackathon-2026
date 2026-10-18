/** Deterministic examples are restricted to the bundled, synthetic sample notes. */
import type { SourceSpan } from '../shared/types.js';
import { ApiError, type ChallengeCandidate, type PrivateAssessment } from './schema.js';
import type { AssessmentContext, StudyProvider } from './provider.js';

interface Fixture {
  title: string; description: string; question: string; source: RegExp; correct: string;
  challenge: string; distinction: string; hint: string; followup: string;
  recognizes: (text: string) => boolean;
  correctionExamples?: string[];
}
const fixtures: Record<'analysis' | 'research', Fixture[]> = {
  analysis: [
    { title: 'Boundedness', description: 'What a bound controls, and what it leaves open.', question: 'How would you explain boundedness—and why being bounded does not mean a sequence settles down?', source: /boundedness describes|fixed finite interval/i,
      correct: 'Boundedness keeps every term in a fixed finite interval; a bounded sequence may still oscillate and fail to converge.', challenge: 'Let me check that I understood: if every term stays in a fixed finite interval, must the sequence converge?', distinction: 'A fixed bound controls the range, not whether the terms approach one value.', hint: 'Think about a sequence that alternates between −1 and 1.', followup: 'Must a bound itself be one of the terms?', recognizes: t => /bound|finite interval|fixed interval/.test(t) && /oscillat|alternat|not.*converg|doesn.t.*converg/.test(t),
      correctionExamples: ['A bounded sequence can alternate between minus one and one, so boundedness does not imply convergence.', 'A bounded sequence can oscillate without converging.', 'Boundedness does not imply convergence.'] },
    { title: 'Convergence & quantifiers', description: 'How ε, N, and the entire tail fit together.', question: 'In the definition of convergence, how is N chosen, and which later terms does it need to control?', source: /order of the choices|N may depend/i,
      correct: 'N may depend on ε, but once selected it must work for every later index n ≥ N.', challenge: 'Let me check that I understood: after choosing ε, can we choose a new N separately for each later term?', distinction: 'The same N must control every later term after ε is fixed.', hint: 'Look at what “for every n ≥ N” requires after N has been chosen.', followup: 'How does choosing N greater than 1/ε establish convergence of 1/n?', recognizes: t => /epsilon|ε|tolerance/.test(t) && /every|all|whole|entire/.test(t) && /later|tail|after/.test(t),
      correctionExamples: ['N can depend on epsilon, but not on the later index n.', 'The same N must work for every later term after epsilon is fixed.'] },
    { title: 'Monotone convergence', description: 'Why direction and a bound work together.', question: 'What does monotonicity add to boundedness in the monotone convergence theorem?', source: /both ideas matter|bounded monotone sequence|monotonicity makes/i,
      correct: 'Every bounded monotone real sequence converges. Boundedness supplies a finite bound; monotonicity prevents a return to oscillation.', challenge: 'Let me check that I understood: boundedness alone is enough to guarantee convergence?', distinction: 'The theorem needs monotonicity as well as boundedness.', hint: 'What would stop a bounded sequence from repeatedly switching between two values?', followup: 'Where is monotonicity used to control the entire tail in the supremum proof?', recognizes: t => /bound/.test(t) && /monoton|one direction|nondecreas|nonincreas/.test(t) && /converg|oscillat|tail/.test(t),
      correctionExamples: ['The theorem requires both boundedness and monotonicity.', 'You dropped monotonicity. A bounded sequence can oscillate. The theorem needs it to keep moving in one direction.', 'A bounded monotone real sequence converges; boundedness alone is not sufficient.'] },
    { title: 'Subsequences', description: 'Moving forward through indices, and a theorem’s exact scope.', question: 'What does a convergent subsequence tell us—and not tell us—about the original bounded sequence?', source: /guarantees a convergent subsequence|Bolzano|whole sequence converges/i,
      correct: 'Every bounded real sequence has a convergent subsequence, but the whole sequence need not converge.', challenge: 'Let me check that I understood: Bolzano–Weierstrass guarantees that every bounded real sequence itself converges?', distinction: 'The theorem guarantees convergence of a subsequence, not necessarily the whole sequence.', hint: 'Which part of the sequence does the theorem actually promise will converge?', followup: 'How do the even and odd subsequences of (−1)ⁿ illustrate this distinction?', recognizes: t => /subsequence|sub.sequence/.test(t) && /whole|original|entire/.test(t) && /not|doesn.t|needn.t/.test(t),
      correctionExamples: ['Only a subsequence is guaranteed to converge, not the whole sequence.'] },
  ],
  research: [
    { title: 'Sampling & assignment', description: 'Who enters the study versus which treatment they receive.', question: 'How would you explain the difference between random sampling and random assignment?', source: /answer different questions|sampling concerns who/i,
      correct: 'Random sampling concerns who enters the study; random assignment concerns which treatment participants receive. Assignment alone does not make a volunteer sample representative.', challenge: 'Let me check that I understood: randomly assigning volunteers also guarantees they represent the whole population?', distinction: 'Group assignment does not establish population representation.', hint: 'Does randomizing treatments change who volunteered in the first place?', followup: 'What can a randomized experiment with volunteers tell us about a wider population?', recognizes: t => /sampl/.test(t) && /assign/.test(t) && /who|select|enter|participant/.test(t) && /treatment|group|condition/.test(t),
      correctionExamples: ['Assignment alone does not make a volunteer sample representative.', "You can randomly assign volunteers. That doesn't make the volunteer group representative.", 'Random assignment does not guarantee a representative sample.'] },
    { title: 'Association & causal claims', description: 'Confounding, causal support, and the limits of generalization.', question: 'How could motivation create an association between app use and grades without an effect of the app?', source: /confounder is|prior motivation|association alone/i,
      correct: 'An association alone does not establish causation. Prior motivation can influence both app use and grades; random assignment addresses systematic pre-treatment differences in expectation, but other limitations remain.', challenge: 'Let me check that I understood: observing higher grades among app users is enough by itself to establish an app effect?', distinction: 'An observed association can be explained by confounding rather than an app effect.', hint: 'What could influence both choosing the app and academic performance?', followup: 'Why would random assignment strengthen the causal comparison while still leaving limits?', recognizes: t => /motivat|confound/.test(t) && /both|app/.test(t) && /grade|performance|outcome/.test(t),
      correctionExamples: ['Association alone does not establish causation.', 'Motivation can influence both app use and grades, so the association alone does not establish an app effect.'] },
  ],
};
const normal = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
// This adapter has no semantic model. Credit only a complete reviewed fixture statement,
// never a bag of topic/negation words or a correct phrase inside a contradictory answer.
// All other phrasing remains unassessed; the live adapter considers free-form arguments.
const correctionKey = (text: string) => normal(text.normalize('NFKC').replace(/\bN\b/g, 'threshold-symbol').replace(/\bn\b/g, 'index-symbol')).replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:no|not quite|let me correct that) /, '');
const recognizesCorrection = (entry: Fixture, text: string) => [entry.correct, entry.distinction, ...(entry.correctionExamples || [])].some(example => correctionKey(example) === correctionKey(text));

export class DemoProvider implements StudyProvider {
  constructor(private sample: 'analysis' | 'research') {}
  private fixture(sources: SourceSpan[], title?: string) {
    const list = fixtures[this.sample];
    const entry = list.find(x => x.title === title) || list.find(x => sources.some(s => x.source.test(normal(s.text)))) || list[0];
    const source = sources.find(s => entry.source.test(normal(s.text)));
    if (!source) throw new ApiError(400, 'This sample passage was not found. Reload the bundled sample, or configure live study for your own notes.', 'DEMO_SOURCE_MISSING');
    return { entry, source };
  }
  async concepts(sources: SourceSpan[]) {
    const joined = normal(sources.map(s => s.text).join(' '));
    const valid = this.sample === 'analysis' ? joined.includes('monotonicity') && joined.includes('supremum') && joined.includes('subsequence') : joined.includes('random sampling') && joined.includes('random assignment') && joined.includes('motivation');
    if (!valid) throw new ApiError(400, 'Sample demo only works with the bundled synthetic notes. Your own documents need live study.', 'DEMO_ONLY');
    return { concepts: fixtures[this.sample].map(entry => {
      const { source } = this.fixture(sources, entry.title);
      const pageSources = sources.filter(s => s.documentId === source.documentId && s.pageIndex === source.pageIndex);
      return { title: entry.title, description: entry.description, question: entry.question, sourceIds: [source.id, ...pageSources.filter(s => s.id !== source.id).map(s => s.id)].slice(0, 16) };
    }) };
  }
  async assess(context: AssessmentContext): Promise<PrivateAssessment> {
    const { request, state, sources, challengeAllowed } = context;
    // Editable concept names must not change which fixture its original passages support.
    const conceptSources = sources.filter(s => request.concept.sourceIds.includes(s.id));
    const { entry, source } = this.fixture(conceptSources.length ? conceptSources : sources, request.concept.title);
    const base: PrivateAssessment = { interpretation: '', strength: '', gap: '', judgment: 'not-assessed', nextAction: 'follow-up', visibleText: '', spokenText: '', sourceIds: [source.id], challenge: null, correctionAccepted: false };
    const text = normal(request.text);
    if (request.action === 'hint') return { ...base, nextAction: 'hint', visibleText: entry.hint };
    if (request.action === 'source') return { ...base, nextAction: 'source', visibleText: 'I’ve marked the relevant passage. Look for the condition or distinction the author keeps explicit.' };
    if (request.action === 'explain') return { ...base, nextAction: 'explain', visibleText: `${entry.correct} ${entry.followup}` };
    if (state.pending) {
      const recognized = recognizesCorrection(entry, request.text);
      return { ...base, judgment: recognized ? 'correct' : 'uncertain', correctionAccepted: recognized, visibleText: recognized ? `You identified the key distinction: ${entry.distinction}` : entry.hint, strength: recognized ? entry.distinction : '' };
    }
    if (request.action === 'accept') return { ...base, nextAction: 'follow-up', visibleText: `Could you add a brief reason in your own words? ${entry.followup}` };
    if (entry.recognizes(text) && !/i (?:don.t|do not) know|not sure|maybe/.test(text)) {
      const candidate: ChallengeCandidate = { candidate: entry.challenge, correction: entry.correct, distinction: entry.distinction, sourceIds: [source.id], quote: source.text, hint: entry.hint };
      return { ...base, judgment: 'correct', strength: entry.correct, nextAction: challengeAllowed ? 'challenge' : 'paraphrase', visibleText: challengeAllowed ? entry.challenge : `Let me check that I understood: ${entry.correct} Does that preserve your explanation?`, challenge: challengeAllowed ? candidate : null };
    }
    return { ...base, judgment: 'uncertain', nextAction: 'clarify', gap: 'This sample response was not evaluated by a live model.', visibleText: `This sample demo can’t reliably judge that wording. Compare your explanation with this passage, then try one concrete distinction: ${entry.followup}` };
  }
  async verify(candidate: ChallengeCandidate, sources: SourceSpan[]) {
    const fixture = fixtures[this.sample].find(x => x.challenge === candidate.candidate && x.correct === candidate.correction);
    const supported = Boolean(fixture && sources.some(s => candidate.sourceIds.includes(s.id) && s.text === candidate.quote && fixture.source.test(normal(s.text))));
    return { verdict: supported ? 'approved' as const : 'rejected' as const, reason: supported ? 'Pre-reviewed synthetic fixture and original source quote match.' : 'This is not a verified fixture.', sourceIds: candidate.sourceIds };
  }
}
