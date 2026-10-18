import type { EvaluationResult, TeachingSession } from './models';

const gradientRules: Record<string, RegExp> = {
  goal: /loss|error|mistake|wrong|objective|cost|prediction|minimi[sz]/i,
  gradient: /slope|steep|derivative|gradient (is|tells|points|shows|means)/i,
  direction: /opposite|negative gradient|downhill|down the hill|decrease|lower|descend/i,
  steps: /learning rate|step size|small steps|large steps|too (big|large|small)|overshoot/i,
  iteration: /repeat|iterat|again|update|converg|until|each step/i,
  example: /for example|imagine|such as|suppose|like a|ball rolling|hill|fitting a line/i,
};
const questionBank: Record<string, string> = {
  goal: 'What tells us whether the model is getting closer to a good answer?',
  gradient: 'I hear “downhill,” but how do we know which way is downhill?',
  direction: 'If the slope points upward, why would we move the other way?',
  steps: 'What would happen if each step were much too big?',
  iteration: 'After one step, how does it know whether to take another?',
  example: 'Could you walk me through one concrete example?',
};
const hints: Record<string, string> = {
  goal: 'Think about a number that measures how far a prediction is from the target.',
  gradient: 'Picture the steepest slope on a hillside.',
  direction: 'A compass pointing uphill gives you a clue about downhill.',
  steps: 'Imagine jumping down a hill versus taking tiny steps.',
  iteration: 'Think about what changes after each adjustment.',
  example: 'Try a model predicting the price of a house.',
};

export function demoEvaluation(session: TeachingSession, explanation: string, signal: 'explain' | 'too_easy' | 'simpler' | 'hint' = 'explain'): EvaluationResult {
  const combined = [...session.turns.map((t) => t.explanation), explanation].join(' ');
  const concepts = session.topic.rubric.concepts;
  const covered: string[] = []; const partial: string[] = []; const missing: string[] = [];
  for (const concept of concepts) {
    const rule = session.topic.id === 'gradient-descent' ? gradientRules[concept.id] : new RegExp(concept.title.split(/\s|&/)[0].replace(/[^a-z]/gi, ''), 'i');
    const matched = rule?.test(combined) ?? false;
    const current = session.statuses[concept.id];
    if (matched && combined.trim().split(/\s+/).length >= 18) covered.push(concept.id);
    else if (matched || current === 'partial') partial.push(concept.id);
    else if (current === 'covered') covered.push(concept.id);
    else missing.push(concept.id);
  }
  const priority = session.topic.id === 'gradient-descent' ? ['goal', 'gradient', 'direction', 'steps', 'iteration', 'example'] : concepts.map((c) => c.id);
  const target = priority.find((id) => missing.includes(id)) ?? priority.find((id) => partial.includes(id)) ?? priority[0];
  const fallbackQuestion = `I’m still curious about ${concepts.find((c) => c.id === target)?.title.toLowerCase()}. Can you explain that with an example?`;
  let nextQuestion = questionBank[target] ?? fallbackQuestion;
  if (signal === 'too_easy') nextQuestion = target === 'steps' ? 'How would you know whether a learning rate is too large before the model converges?' : `Would your explanation of ${concepts.find((c) => c.id === target)?.title.toLowerCase()} still hold in a harder real-world case?`;
  if (signal === 'simpler') nextQuestion = target === 'gradient' ? 'Imagine a ball on a hill. How could it tell which way goes down?' : `Could you explain ${concepts.find((c) => c.id === target)?.title.toLowerCase()} with an everyday example?`;
  const circular = /gradient descent is (when|just) gradient descent|recursion is (when|just) recursion/i.test(explanation);
  if (circular) nextQuestion = 'I think the definition uses the same word again. What does it mean without that word?';
  const strengths = covered.length ? [`You made ${concepts.find((c) => c.id === covered[0])?.title.toLowerCase()} easier to follow.`] : explanation.trim() ? ['You started with your own explanation.'] : [];
  return {
    coveredConceptIds: covered, partialConceptIds: partial, missingConceptIds: missing,
    misconceptions: circular ? [{ description: 'The explanation repeats the term instead of defining it.', confidence: 'high' }] : [],
    strengths, nextQuestion, questionPurpose: `Probe ${target} without supplying the answer.`,
    suggestedHint: hints[target] ?? `Try connecting ${concepts.find((c) => c.id === target)?.title.toLowerCase()} to something familiar.`,
    shouldFinish: covered.length === concepts.length && session.turns.length >= 2,
    evaluatorConfidence: 'medium',
  };
}
