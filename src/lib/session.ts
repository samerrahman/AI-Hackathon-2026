import { MAX_TURNS, type ConceptStatus, type PublicEvaluation, type LearningReport, type TeachingSession, type Topic, type Difficulty, scoreSchema } from './models';

export const openingQuestion = 'Can you teach me this in your own words? Start wherever you like.';

export function createSession(topic: Topic, difficulty: Difficulty, referenceNotes: string, mode: 'demo' | 'live', rubricToken?: string): TeachingSession {
  return { id: crypto.randomUUID(), topic, difficulty, referenceNotes, rubricToken, turns: [], statuses: Object.fromEntries(topic.rubric.concepts.map((c) => [c.id, 'missing'])), currentQuestion: openingQuestion, mode, phase: 'teaching', createdAt: new Date().toISOString() };
}

export function updateStatuses(topic: Topic, evaluation: PublicEvaluation): Record<string, ConceptStatus> {
  const covered = new Set(evaluation.coveredConceptIds);
  const partial = new Set(evaluation.partialConceptIds);
  return Object.fromEntries(topic.rubric.concepts.map(({ id }) => [id, covered.has(id) ? 'covered' : partial.has(id) ? 'partial' : 'missing']));
}

export function appendTurn(session: TeachingSession, explanation: string, evaluation: PublicEvaluation): TeachingSession {
  if (session.phase !== 'teaching' || session.turns.length >= MAX_TURNS) return session;
  const turns = [...session.turns, { id: crypto.randomUUID(), explanation, question: session.currentQuestion, createdAt: new Date().toISOString(), evaluation }];
  return { ...session, turns, statuses: updateStatuses(session.topic, evaluation), currentQuestion: evaluation.nextQuestion, hint: undefined };
}

export function shouldEnd(session: TeachingSession, evaluation?: PublicEvaluation): boolean {
  return session.turns.length >= MAX_TURNS || Boolean(evaluation?.shouldFinish && session.turns.length >= 3);
}

function score(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }

export function buildReport(session: TeachingSession): LearningReport {
  const concepts = session.topic.rubric.concepts;
  const names = (status: ConceptStatus) => concepts.filter((c) => session.statuses[c.id] === status).map((c) => c.title);
  const covered = names('covered'); const partial = names('partial'); const gaps = names('missing');
  const allWords = session.turns.map((t) => t.explanation).join(' ');
  const hasExample = /for example|imagine|such as|say we|like a|suppose|e\.g\./i.test(allWords);
  const fraction = concepts.length ? (covered.length + partial.length * 0.5) / concepts.length : 0;
  const first = session.turns[0]?.evaluation;
  const firstCount = first ? first.coveredConceptIds.length + first.partialConceptIds.length * 0.5 : 0;
  const delta = Math.round((covered.length + partial.length * 0.5 - firstCount) / Math.max(1, concepts.length) * 100);
  const last = session.turns.at(-1);
  const misconceptions = [...new Set(session.turns.flatMap((t) => t.evaluation.misconceptions.map((m) => m.description)))];
  const exampleSentence = session.turns.flatMap((t) => t.explanation.split(/(?<=[.!?])\s+/)).find((sentence) => /for example|imagine|such as|suppose|like a|e\.g\./i.test(sentence));
  const strengths = [...new Set([...(exampleSentence ? [`Your example: “${exampleSentence.slice(0, 180)}”`] : []), ...session.turns.flatMap((t) => t.evaluation.strengths)])].slice(0, 4);
  const scores = scoreSchema.parse({
    correctness: score(35 + fraction * 60 - misconceptions.length * 7), completeness: score(fraction * 100),
    clarity: score(40 + Math.min(35, allWords.split(/\s+/).length / 7) + covered.length * 3),
    examples: score(hasExample ? 82 : 35), connections: score(30 + fraction * 55 + (session.turns.length > 2 ? 10 : 0)),
  });
  return {
    initialExplanation: session.turns[0]?.explanation ?? 'No explanation submitted.',
    finalUnderstanding: last ? `You explained ${covered.length} of ${concepts.length} core ideas clearly${partial.length ? ` and made progress on ${partial.length} more` : ''}. ${covered.length ? `Your strongest ground was ${covered.slice(0, 2).join(' and ')}.` : 'Start by defining the key ideas in your own words.'}` : 'No explanation submitted yet.',
    demonstrated: covered, partial, gaps, misconceptions, strengths,
    nextReviewTopic: gaps[0] ?? partial[0] ?? `Apply ${session.topic.title} to a new example`,
    scores, improvement: delta > 0 ? `Concept coverage improved by ${delta} percentage points from your first explanation.` : 'Your explanation held steady; try adding a concrete example or a missing connection next time.',
  };
}
