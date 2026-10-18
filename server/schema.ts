import { z } from 'zod';

export const LIMITS = { maxFiles: 5, maxFileBytes: 20 * 1024 * 1024, maxPages: 100, maxTextCharacters: 300_000 };
const id = z.string().min(1).max(180);
const rect = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) });
export const spanSchema = z.object({
  id, documentId: id, pageIndex: z.number().int().min(0).max(LIMITS.maxPages - 1),
  text: z.string().min(1).max(20_000), rects: z.array(rect).max(300).optional(), quality: z.string().max(200),
  kind: z.enum(['paragraph', 'heading', 'equation', 'page']).optional(),
});
export const documentSchema = z.object({
  id, name: z.string().min(1).max(300), size: z.number().min(0).max(LIMITS.maxFileBytes), hash: z.string().min(1).max(200),
  pageCount: z.number().int().min(1).max(LIMITS.maxPages), spans: z.array(spanSchema).max(12_000),
  warnings: z.array(z.string().max(1000)).max(200), kind: z.enum(['pdf', 'text']), processingVersion: z.string().optional(),
});
export const statusSchema = z.enum(['not-discussed', 'explaining', 'needs-another-pass', 'explained-with-support', 'explained-independently']);
export const conceptSchema = z.object({ id, title: z.string().min(1).max(180), description: z.string().max(1500), question: z.string().max(1500), sourceIds: z.array(id).min(1).max(40), status: statusSchema });
export const conceptRequestSchema = z.object({ sessionId: id, documents: z.array(documentSchema).min(1).max(LIMITS.maxFiles), mode: z.enum(['live', 'demo']), sampleId: z.enum(['analysis', 'research']).optional() });
export const turnRequestSchema = conceptRequestSchema.extend({
  turnId: id, revision: z.number().int().min(0), concept: conceptSchema,
  history: z.array(z.object({ id, role: z.enum(['user', 'assistant']), text: z.string().max(12_000), sourceIds: z.array(id).optional(), label: z.string().optional(), conceptId: id.optional() })).max(300),
  text: z.string().max(12_000), action: z.enum(['start', 'answer', 'hint', 'source', 'explain', 'skip', 'end', 'accept']),
  settings: z.object({ challenges: z.enum(['standard', 'gentle', 'off']), audioOutput: z.boolean().optional() }),
  engineState: z.string().max(100_000).optional(),
  selection: z.object({ text: z.string().trim().min(1).max(12_000), documentId: id, pageIndex: z.number().int().min(0), spanIds: z.array(id).max(100) }).optional(),
});

export const challengeSchema = z.object({
  candidate: z.string().min(10).max(1500), correction: z.string().min(10).max(2000), distinction: z.string().min(5).max(1000),
  sourceIds: z.array(id).min(1).max(10), quote: z.string().min(10).max(4000), hint: z.string().min(5).max(1000),
});
export const assessmentSchema = z.object({
  interpretation: z.string().max(1500), strength: z.string().max(1500), gap: z.string().max(1500),
  judgment: z.enum(['correct', 'partial', 'incorrect', 'uncertain', 'not-assessed']),
  nextAction: z.enum(['invite', 'clarify', 'follow-up', 'paraphrase', 'challenge', 'hint', 'source', 'explain', 'advance', 'recap']),
  visibleText: z.string().min(1).max(4000), spokenText: z.string().max(4000), sourceIds: z.array(id).min(1).max(20),
  challenge: challengeSchema.nullable(), correctionAccepted: z.boolean(),
});
export type PrivateAssessment = z.infer<typeof assessmentSchema>;
export type ChallengeCandidate = z.infer<typeof challengeSchema>;
export const outlineSchema = z.object({ concepts: z.array(z.object({ title: z.string().min(1).max(180), description: z.string().max(1500), question: z.string().min(1).max(1500), sourceIds: z.array(id).min(1).max(40) })).min(1).max(10) });
export const verificationSchema = z.object({ verdict: z.enum(['approved', 'rejected', 'uncertain']), reason: z.string().min(1).max(1000), sourceIds: z.array(id).min(1).max(10) });

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED') { super(message); }
}
