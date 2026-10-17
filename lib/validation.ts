import { z } from 'zod';

export const tutorReplySchema = z.object({
  reply: z.string().min(1).max(700), teachingMove: z.string().min(1).max(80),
  understandingDelta: z.number().int().min(0).max(12),
  isOnTopic: z.boolean(), feedbackReason: z.string().min(1).max(160),
  conceptsDemonstrated: z.array(z.string().max(100)).max(6),
  possibleMisconceptions: z.array(z.string().max(160)).max(4),
  intentionalMistake: z.boolean(), suggestedPrompts: z.array(z.string().max(140)).min(1).max(3),
  shouldOfferCompletion: z.boolean(),
});
export const assessmentSchema = z.object({
  score: z.number().int().min(0).max(100), label: z.enum(['Learning','Getting There','Strong Teacher','Master Explainer']),
  strengths: z.array(z.string().max(180)).max(6), growthAreas: z.array(z.string().max(180)).max(6),
  misconceptions: z.array(z.string().max(180)).max(5), exampleQuality: z.string().max(300),
  followUpAbility: z.string().max(300), recommendation: z.string().max(300),
  reviewQuestions: z.array(z.string().max(200)).length(3), xp: z.number().int().min(0).max(1000),
  badge: z.string().max(80).nullable(), evidence: z.array(z.string().max(220)).max(6),
});

export function clampMeter(current: number, delta: number) { return Math.max(0, Math.min(100, current + delta)); }
export function scoreLabel(score: number) { return score >= 90 ? 'Master Explainer' : score >= 75 ? 'Strong Teacher' : score >= 50 ? 'Getting There' : 'Learning'; }

export function isLowEffortTeaching(text: string, previousTeacherTexts: string[] = []) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 4 || new Set(words).size < 3) return true;
  if (previousTeacherTexts.some((item)=>item.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()===normalized)) return true;
  return /^(?:lol|lmao|idk|whatever|nope|nah|yes|no|poop|asdf|test)(?:\s+\w+){0,2}$/.test(normalized);
}
