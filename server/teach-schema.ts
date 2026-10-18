import { z } from 'zod';
import { conceptRequestSchema, documentSchema } from './schema.js';

export const depthSchema = z.enum(['big-picture', 'exam-ready', 'expert']);
export type Depth = z.infer<typeof depthSchema>;
export const teachModeSchema = z.enum(['teach', 'relearn']);
export type TeachMode = z.infer<typeof teachModeSchema>;
export const stageSchema = z.enum(['cover', 'explain', 'connect']);
export const problemTypeSchema = z.enum(['wrong', 'vague', 'missing_step', 'undefined_term', 'off_topic']);
export const styleSchema = z.enum(['literal', 'analogy', 'boundary', 'causal', 'definition', 'contrast', 'sequence', 'example', 'what_if']);
const id = z.string().min(1).max(180);
// Empty only for topics taught without notes; the engine requires real citations whenever notes exist.
const sourceIds = z.array(id).max(20);
const evidenceSchema = z.object({ rubricItemId: id, teacherMessageId: id, quote: z.string().min(1).max(1200) });
const anchoredSchema = z.object({ teacherMessageId: id, anchorQuote: z.string().min(1).max(500) });
export const focusSchema = anchoredSchema.extend({
  type: problemTypeSchema,
  instruction: z.enum(['ask_clarify', 'ask_why', 'ask_define', 'ask_boundary', 'ask_contrast', 'ask_example', 'ask_order', 'ask_analogy']),
});
export const mistakeSchema = anchoredSchema.extend({ restatement: z.string().min(5).max(300) });
export const relearnBriefSchema = z.object({
  teacherQuote: z.string().min(1).max(1200), accurateSummary: z.string().min(10).max(1800),
  correction: z.string().max(1200), quizFeedback: z.string().max(1000),
  quizQuestion: z.string().min(5).max(600), sourceIds,
});
export const judgeSchema = z.object({
  credits: z.array(evidenceSchema).max(30), revocations: z.array(evidenceSchema).max(30),
  problems: z.array(z.object({ type: problemTypeSchema, description: z.string().min(1).max(220), sourceIds: z.array(id).max(10),
    affectedRubricItemIds: z.array(id).max(18), teacherMessageId: id, quote: z.string().min(1).max(1200) })).max(12),
  focus: focusSchema.nullable(), mistake: mistakeSchema.nullable(), allSatisfied: z.boolean(),
  relearnBrief: relearnBriefSchema.nullable(),
});
export type JudgeResult = z.infer<typeof judgeSchema>;
export const stuSchema = z.object({ text: z.string().min(5).max(900), questionStyle: styleSchema });
export type StuResult = z.infer<typeof stuSchema>;
const coverTooDetailed = /\d|[=+×÷<>∑∫^]|\b(edge cases?|exception|limitation|deriv|formula|equation|exact|numerical|quantitative|threshold|boundary case)\b/i;
export const rubricSchema = z.object({
  coreIdeas: z.array(z.string().min(2).max(100)).min(2).max(6),
  items: z.array(z.object({ ideaIndex: z.number().int().min(0).max(5), stage: stageSchema, requirement: z.string().min(8).max(500), sourceIds })).min(6).max(18),
}).superRefine((rubric, ctx) => {
  for (const [index, item] of rubric.items.entries()) {
    if (item.ideaIndex >= rubric.coreIdeas.length) ctx.addIssue({ code: 'custom', path: ['items', index, 'ideaIndex'], message: 'Unknown core idea' });
    if (item.stage === 'cover' && coverTooDetailed.test(item.requirement)) ctx.addIssue({ code: 'custom', path: ['items', index, 'requirement'], message: 'Cover must contain gist only' });
  }
  for (const stage of stageSchema.options) if (!rubric.items.some(item => item.stage === stage)) ctx.addIssue({ code: 'custom', path: ['items'], message: `Missing ${stage} stage` });
  for (let ideaIndex = 0; ideaIndex < rubric.coreIdeas.length; ideaIndex++) {
    if (!rubric.items.some(item => item.ideaIndex === ideaIndex && item.stage === 'cover')) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Every idea needs a cover item' });
  }
});
export type RubricDraft = z.infer<typeof rubricSchema>;
export const createTopicSchema = conceptRequestSchema.omit({ mode: true, sessionId: true }).extend({
  title: z.string().trim().min(2).max(160), depth: depthSchema, mode: z.enum(['live', 'demo']),
  // No documents means the student chose to just start talking.
  documents: z.array(documentSchema).max(5),
});
export const teachTurnSchema = z.object({
  topicId: id, stateToken: z.string().min(20).max(300_000), documents: z.array(documentSchema).max(5),
  turnId: id, revision: z.number().int().min(1), messageId: id, text: z.string().trim().min(1).max(12_000),
});
export type TeachTurnRequest = z.infer<typeof teachTurnSchema>;
export type CreateTopicRequest = z.infer<typeof createTopicSchema>;
