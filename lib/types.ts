export type Role = 'teacher' | 'student';
export type Message = { id: string; role: Role; text: string; intentionalMistake?: boolean };
export type LessonConfig = { subject: string; topic: string; gradeBand: string; sourceName?: string; sourceNotes?: string };
export type TutorReply = {
  reply: string;
  teachingMove: string;
  understandingDelta: number;
  isOnTopic: boolean;
  feedbackReason: string;
  conceptsDemonstrated: string[];
  possibleMisconceptions: string[];
  intentionalMistake: boolean;
  suggestedPrompts: string[];
  shouldOfferCompletion: boolean;
};
export type Assessment = {
  score: number; label: 'Learning' | 'Getting There' | 'Strong Teacher' | 'Master Explainer';
  strengths: string[]; growthAreas: string[]; misconceptions: string[];
  exampleQuality: string; followUpAbility: string; recommendation: string;
  reviewQuestions: string[]; xp: number; badge: string | null; evidence: string[];
};
