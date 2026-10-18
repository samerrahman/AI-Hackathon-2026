/** Source rectangles use top-left normalized PDF.js viewport coordinates, including intrinsic page rotation. */
export interface SourceRect { x: number; y: number; width: number; height: number }
export interface SourceSpan {
  id: string;
  documentId: string;
  pageIndex: number;
  text: string;
  rects?: SourceRect[];
  quality: string;
  kind?: 'paragraph' | 'heading' | 'equation' | 'page';
}
export interface StudyDocument {
  id: string;
  name: string;
  size: number;
  hash: string;
  pageCount: number;
  spans: SourceSpan[];
  warnings: string[];
  kind: 'pdf' | 'text';
  blob?: Blob;
  processingVersion?: string;
}
export type ConceptStatus = 'not-discussed' | 'explaining' | 'needs-another-pass' | 'explained-with-support' | 'explained-independently';
export interface Concept {
  id: string;
  title: string;
  description: string;
  question: string;
  sourceIds: string[];
  status: ConceptStatus;
}
export interface SelectionContext { text: string; documentId: string; pageIndex: number; spanIds: string[] }
export interface SessionSettings { challenges: 'standard' | 'gentle' | 'off'; audioOutput?: boolean }
export type TurnAction = 'start' | 'answer' | 'hint' | 'source' | 'explain' | 'skip' | 'end' | 'accept';
export type CharacterState = 'neutral' | 'listening' | 'thinking' | 'speaking' | 'puzzled' | 'pleased' | 'blink';
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sourceIds?: string[];
  label?: string;
  conceptId?: string;
}
export interface EvidenceRecord {
  id: string;
  conceptId: string;
  turnId: string;
  kind: 'explained' | 'corrected' | 'help' | 'review';
  summary: string;
  studentText: string;
  sourceIds: string[];
  support: 'none' | 'question' | 'hint' | 'source' | 'explanation';
  independently: boolean;
}
export interface ConceptRequest {
  sessionId: string;
  documents: StudyDocument[];
  mode: 'live' | 'demo';
  sampleId?: 'analysis' | 'research';
}
export interface TurnRequest extends ConceptRequest {
  submittedAt?: number;
  turnId: string;
  revision: number;
  concept: Concept;
  history: ConversationMessage[];
  text: string;
  action: TurnAction;
  settings: SessionSettings;
  /** Authenticated, encrypted server state. Persist it but do not interpret it. */
  engineState?: string;
  selection?: SelectionContext;
}
export interface AssessmentResult {
  collectionId?: string;
  timings?: TurnTimings;
  sessionId: string;
  turnId: string;
  revision: number;
  conceptId: string;
  visibleText: string;
  spokenText?: string;
  label?: 'Check my understanding';
  sourceIds: string[];
  /** New records from this turn, append once by id. */
  evidence: EvidenceRecord[];
  engineState: string;
  pendingChallenge: boolean;
  character: CharacterState;
  status: ConceptStatus;
  nextAction: 'invite' | 'clarify' | 'follow-up' | 'paraphrase' | 'challenge' | 'hint' | 'source' | 'explain' | 'advance' | 'recap';
  /** Present only after a challenge has been resolved; never contains the false statement. */
  resolvedCorrection?: { statement: string; sourceIds: string[]; studentCorrected: boolean };
}
export interface AppConfig {
  liveAvailable: boolean;
  voiceAvailable: boolean;
  provider: 'StepFun' | 'Groq' | 'Gemini';
  providerKey: 'STEPFUN_API_KEY' | 'GROQ_API_KEY' | 'GEMINI_API_KEY';
  voiceProvider: 'Off' | 'StepFun';
  voiceKey: 'STEPFUN_API_KEY' | null;
  limits: { maxFiles: number; maxFileBytes: number; maxPages: number; maxTextCharacters: number };
}
export interface ProviderTiming { task:string; durationMs:number; firstChunkMs?:number; firstReplyMs?:number; inputTokens?:number; outputTokens?:number; inputCharacters:number }
export interface TurnTimings { submissionToReceiptMs?:number; contextMs:number; firstVisibleMs?:number; totalMs:number; providerCalls:ProviderTiming[] }
export type TurnStreamEvent = {sessionId:string;turnId:string;revision:number;conceptId:string} & (
  {type:'ready';receivedAt:number}|{type:'text';text:string}|{type:'complete';result:AssessmentResult}|{type:'error';error:string;code?:string}
);
