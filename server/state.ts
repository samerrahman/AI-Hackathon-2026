import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConceptStatus, EvidenceRecord, StudyDocument } from '../shared/types.js';
import type { ChallengeCandidate } from './schema.js';
import { ApiError } from './schema.js';

export interface PendingChallenge extends ChallengeCandidate { conceptId: string; attempts: number }
export interface EngineState {
  version: 1; sessionId: string; scope: string; substantialTurns: number; lastChallengeAt: number;
  activeConceptId: string; pending?: PendingChallenge;
  support: Record<string, EvidenceRecord['support']>;
  statuses: Record<string, ConceptStatus>;
}
let cachedKey: Buffer | undefined;
export function stateKey() {
  if (cachedKey) return cachedKey;
  if (process.env.SESSION_SECRET) return cachedKey = createHash('sha256').update(process.env.SESSION_SECRET).digest();
  const dir = resolve('.miso');
  const file = resolve(dir, 'state-key');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(file)) writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' });
  return cachedKey = readFileSync(file);
}
export function scopeFor(documents: StudyDocument[]) {
  // Include actual extracted text, not just the caller-supplied file hashes.
  return createHash('sha256').update(JSON.stringify(documents.map(d => [d.id, d.hash, d.spans.map(s => [s.id, s.documentId, s.pageIndex, s.text])]))).digest('hex');
}
export function encodeState(state: EngineState): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', stateKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function decodeState(token: string | undefined, sessionId: string, documents: StudyDocument[]): EngineState {
  const scope = scopeFor(documents);
  if (!token) return { version: 1, sessionId, scope, substantialTurns: 0, lastChallengeAt: 0, activeConceptId: '', support: {}, statuses: {} };
  try {
    const bytes = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', stateKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const state = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as EngineState;
    if (state.version !== 1 || state.sessionId !== sessionId || state.scope !== scope) throw new Error('State scope differs');
    return state;
  } catch { throw new ApiError(409, 'This session state no longer matches its saved notes. Start a new session with these documents; your existing session is still saved.', 'STATE_MISMATCH'); }
}
