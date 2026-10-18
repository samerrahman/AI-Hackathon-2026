import { z } from 'zod';

export const difficultySchema = z.enum(['introductory', 'intermediate', 'advanced']);
export const conceptStatusSchema = z.enum(['missing', 'partial', 'covered']);
export const conceptSchema = z.object({ id: z.string().min(1), title: z.string().min(1), criterion: z.string().min(1) });
export const rubricSchema = z.object({ concepts: z.array(conceptSchema).min(1).max(12), source: z.enum(['curated', 'reference notes', 'AI-generated rubric']) });
export const topicSchema = z.object({ id: z.string().min(1), title: z.string().min(1), subtitle: z.string(), icon: z.string(), rubric: rubricSchema });
export const misconceptionSchema = z.object({ conceptId: z.string().optional(), description: z.string().min(1), confidence: z.enum(['low', 'medium', 'high']) });
export const evaluationSchema = z.object({
  coveredConceptIds: z.array(z.string()),
  partialConceptIds: z.array(z.string()),
  missingConceptIds: z.array(z.string()),
  misconceptions: z.array(misconceptionSchema),
  strengths: z.array(z.string()),
  nextQuestion: z.string().min(3).refine((text) => (text.match(/\?/g) ?? []).length === 1, 'Ask exactly one question.'),
  questionPurpose: z.string().min(1),
  suggestedHint: z.string().optional(),
  shouldFinish: z.boolean(),
  evaluatorConfidence: z.enum(['low', 'medium', 'high']),
});
export const publicEvaluationSchema = evaluationSchema.omit({ questionPurpose: true });
export const turnSchema = z.object({ id: z.string(), explanation: z.string(), question: z.string(), createdAt: z.string(), evaluation: publicEvaluationSchema });
export const scoreSchema = z.object({ correctness: z.number().int().min(0).max(100), completeness: z.number().int().min(0).max(100), clarity: z.number().int().min(0).max(100), examples: z.number().int().min(0).max(100), connections: z.number().int().min(0).max(100) });
export const reportSchema = z.object({
  initialExplanation: z.string(), finalUnderstanding: z.string(),
  demonstrated: z.array(z.string()), partial: z.array(z.string()), gaps: z.array(z.string()),
  misconceptions: z.array(z.string()), strengths: z.array(z.string()), nextReviewTopic: z.string(),
  scores: scoreSchema, improvement: z.string(),
});
export const sessionSchema = z.object({
  id: z.string(), topic: topicSchema, difficulty: difficultySchema, referenceNotes: z.string(), rubricToken: z.string().optional(),
  turns: z.array(turnSchema), statuses: z.record(z.string(), conceptStatusSchema),
  currentQuestion: z.string(), hint: z.string().optional(), mode: z.enum(['demo', 'live']),
  phase: z.enum(['teaching', 'report']), createdAt: z.string(), report: reportSchema.optional(),
});

export type Concept = z.infer<typeof conceptSchema>;
export type ConceptRubric = z.infer<typeof rubricSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type ConceptStatus = z.infer<typeof conceptStatusSchema>;
export type EvaluationResult = z.infer<typeof evaluationSchema>;
export type PublicEvaluation = z.infer<typeof publicEvaluationSchema>;
export type ConversationTurn = z.infer<typeof turnSchema>;
export type TeachingSession = z.infer<typeof sessionSchema>;
export type LearningReport = z.infer<typeof reportSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export const MAX_TURNS = 6;
