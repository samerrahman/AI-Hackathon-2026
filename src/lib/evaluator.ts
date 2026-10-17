import OpenAI from 'openai';
import { evaluationSchema, rubricSchema, type ConceptRubric, type EvaluationResult, type TeachingSession } from './models';
import { demoEvaluation } from './demo';

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fence ? fence[1] : trimmed);
}

export function parseEvaluation(text: string): EvaluationResult { return evaluationSchema.parse(extractJson(text)); }

export function demoMode(): boolean { return process.env.DEMO_MODE === 'true' || !process.env.STEPFUN_API_KEY; }

function client(): OpenAI {
  return new OpenAI({ apiKey: process.env.STEPFUN_API_KEY, baseURL: process.env.STEPFUN_BASE_URL || 'https://api.stepfun.ai/v1', timeout: 18000, maxRetries: 0 });
}

async function completion(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): Promise<string> {
  const result = await client().chat.completions.create({ model: process.env.STEPFUN_MODEL || 'step-5-preview', messages, temperature: 0.4 });
  return result.choices[0]?.message?.content ?? '';
}

export async function evaluate(session: TeachingSession, explanation: string, signal: 'explain' | 'too_easy' | 'simpler' | 'hint', requestCompletion = completion): Promise<EvaluationResult> {
  if (demoMode()) return demoEvaluation(session, explanation, signal);
  const system = `You are the hidden evaluator for DumbAI. Assess the student's cumulative understanding against the private rubric. Respond with ONLY one JSON object with these exact keys: coveredConceptIds, partialConceptIds, missingConceptIds (arrays of rubric IDs); misconceptions (array of {conceptId optional, description, confidence: low|medium|high}); strengths (array of brief observations); nextQuestion (exactly ONE short warm, curious, strategically naive question that exposes the most useful gap); questionPurpose (private rationale); suggestedHint (optional, small nudge without the answer); shouldFinish (boolean, only after at least 3 explanations and strong coverage); evaluatorConfidence (low|medium|high). Do not reveal the complete answer. Detect circular definitions, unexplained jargon, weak examples, contradictions and assumptions. Adapt to the selected difficulty and control signal. Never be sarcastic or insulting. No Markdown.`;
  const user = JSON.stringify({ topic: session.topic.title, rubric: session.topic.rubric, referenceNotes: session.referenceNotes, difficulty: session.difficulty, previousTurns: session.turns.map(({ explanation, question }) => ({ explanation, question })), latestExplanation: explanation, controlSignal: signal });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
  try {
    const first = await requestCompletion(messages);
    try { return parseEvaluation(first); } catch {
      const repaired = await requestCompletion([...messages, { role: 'assistant', content: first }, { role: 'user', content: 'Your response failed JSON parsing or schema validation. Return a corrected JSON object only, with every required key and valid values.' }]);
      return parseEvaluation(repaired);
    }
  } catch {
    return demoEvaluation(session, explanation, signal);
  }
}

export async function generateRubric(title: string): Promise<ConceptRubric> {
  if (demoMode()) return { source: 'AI-generated rubric', concepts: [
    { id: 'definition', title: 'Core idea', criterion: `Clearly define ${title}.` },
    { id: 'mechanism', title: 'How it works', criterion: `Explain how ${title} works.` },
    { id: 'example', title: 'Concrete example', criterion: `Give a concrete example of ${title}.` },
    { id: 'connection', title: 'Why it matters', criterion: `Connect ${title} to a useful context.` },
  ] };
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'Create a provisional teaching rubric for a student topic. Return only JSON shaped {"source":"AI-generated rubric","concepts":[{"id":"simple-slug","title":"short label","criterion":"one sentence"}]}. Use 4-6 accurate, distinct concepts. No Markdown.' },
    { role: 'user', content: title },
  ];
  try {
    const result = await completion(messages);
    try { return rubricSchema.parse(extractJson(result)); } catch {
      const repaired = await completion([...messages, { role: 'assistant', content: result }, { role: 'user', content: 'Return corrected valid JSON only.' }]);
      return rubricSchema.parse(extractJson(repaired));
    }
  } catch {
    return { source: 'AI-generated rubric', concepts: [
      { id: 'definition', title: 'Core idea', criterion: `Clearly define ${title}.` },
      { id: 'mechanism', title: 'How it works', criterion: `Explain how ${title} works.` },
      { id: 'example', title: 'Concrete example', criterion: `Give a concrete example of ${title}.` },
    ] };
  }
}
