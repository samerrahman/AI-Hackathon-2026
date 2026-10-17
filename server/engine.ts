import { randomUUID } from 'node:crypto';
import type { AssessmentResult, ConceptRequest, EvidenceRecord, SourceSpan, TurnRequest } from '../shared/types.js';
import { ApiError, LIMITS, assessmentSchema, outlineSchema, verificationSchema } from './schema.js';
import { decodeState, encodeState, type EngineState, type PendingChallenge } from './state.js';
import { relevantSources, type StudyProvider } from './provider.js';

export function validateSources(documents: ConceptRequest['documents']): SourceSpan[] {
  const documentIds = new Set<string>();
  const spanIds = new Set<string>();
  const spans: SourceSpan[] = [];
  let characters = 0;
  for (const document of documents) {
    if (documentIds.has(document.id)) throw new ApiError(400, 'Duplicate document references were found. Remove the duplicate and retry.');
    documentIds.add(document.id);
    for (const span of document.spans) {
      if (span.documentId !== document.id || span.pageIndex >= document.pageCount || spanIds.has(span.id)) throw new ApiError(400, 'A source reference does not match its document. Reopen the notes and retry.', 'INVALID_SOURCE');
      if (span.rects?.some(r => r.x + r.width > 1.001 || r.y + r.height > 1.001)) throw new ApiError(400, 'A source location extends outside its page.', 'INVALID_SOURCE');
      characters += span.text.length;
      spanIds.add(span.id);
      spans.push(span);
    }
  }
  if (characters > LIMITS.maxTextCharacters) throw new ApiError(413, `This collection exceeds ${LIMITS.maxTextCharacters.toLocaleString()} extracted characters. Use a smaller collection.`);
  if (characters < 40) throw new ApiError(422, 'There is too little readable text to prepare a grounded session. Paste the notes or choose a text-based PDF.', 'EMPTY_EXTRACTION');
  return spans;
}
export function requireReferences(ids: string[], sources: SourceSpan[]) {
  const valid = new Set(sources.map(s => s.id));
  if (!ids.length || ids.some(id => !valid.has(id))) throw new ApiError(502, 'Miso could not ground a response in these notes and did not use it. Your draft is safe; retry.', 'INVALID_SOURCE');
}
function validateSelection(request: TurnRequest, spans: SourceSpan[]) {
  if (!request.selection) return;
  const selected = request.selection;
  const page = spans.filter(s => s.documentId === selected.documentId && s.pageIndex === selected.pageIndex);
  const normalized = (s: string) => s.replace(/\s+/g, ' ').trim();
  const quote = normalized(selected.text);
  let offset = 0;
  const ranges = page.map(span => {
    const text = normalized(span.text);
    const range = { span, text, start: offset, end: offset + text.length };
    offset = range.end + 1;
    return range;
  });
  const pageText = ranges.map(range => range.text).join(' ');
  if (!quote || !page.length || selected.spanIds.some(id => !page.some(s => s.id === id)) || !pageText.includes(quote)) {
    throw new ApiError(400, 'That selection could not be matched to this page. Select the passage again, or ask using its page reference.', 'INVALID_SELECTION');
  }
  // Map the submitted quote to real text, including when PDF geometry was unavailable.
  // Repeated text is narrowed by the client's native-text span IDs when possible.
  const matches: SourceSpan[][] = [];
  let match = pageText.indexOf(quote);
  while (match >= 0) {
    matches.push(ranges.filter(range => range.start < match + quote.length && range.end > match).map(range => range.span));
    match = pageText.indexOf(quote, match + Math.max(quote.length, 1));
  }
  const matchingIds = matches.filter(group => group.some(span => selected.spanIds.includes(span.id)));
  const grounded = matchingIds.length ? matchingIds : matches;
  return { ...selected, spanIds: [...new Set(grounded.flat().map(span => span.id))] };
}
export async function createConcepts(request: ConceptRequest, provider: StudyProvider) {
  const sources = validateSources(request.documents);
  const outline = outlineSchema.parse(await provider.concepts(sources));
  return { concepts: outline.concepts.map(concept => {
    requireReferences(concept.sourceIds, sources);
    return { ...concept, id: randomUUID(), status: 'not-discussed' as const };
  }) };
}
export function challengeIsAllowed(state: EngineState, setting: TurnRequest['settings']['challenges']) {
  const spacing = setting === 'gentle' ? 6 : 3;
  return setting !== 'off' && !state.pending && state.substantialTurns >= spacing && state.substantialTurns - state.lastChallengeAt >= spacing;
}
function supportedQuote(candidate: PendingChallenge | NonNullable<Awaited<ReturnType<StudyProvider['assess']>>['challenge']>, sources: SourceSpan[]) {
  requireReferences(candidate.sourceIds, sources);
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  return sources.some(s => candidate.sourceIds.includes(s.id) && normalize(s.text).includes(normalize(candidate.quote)));
}
function evidence(request: TurnRequest, state: EngineState, kind: EvidenceRecord['kind'], summary: string, sourceIds: string[], conceptId = request.concept.id): EvidenceRecord {
  const support = state.support[conceptId] || 'none';
  return { id: `${request.turnId}:${kind}:${conceptId}`, conceptId, turnId: request.turnId, kind, summary, studentText: request.text, sourceIds, support, independently: (kind === 'explained' || kind === 'corrected') && (support === 'none' || support === 'question') };
}

export async function runTurn(request: TurnRequest, provider: StudyProvider): Promise<AssessmentResult> {
  const all = validateSources(request.documents);
  requireReferences(request.concept.sourceIds, all);
  const selection = validateSelection(request, all);
  if (selection) request = { ...request, selection };
  const state = decodeState(request.engineState, request.sessionId, request.documents);
  const records: EvidenceRecord[] = [];
  const result = (visibleText: string, nextAction: AssessmentResult['nextAction'], sourceIds = request.concept.sourceIds.slice(0, 1), extra: Partial<AssessmentResult> = {}): AssessmentResult => ({
    sessionId: request.sessionId, turnId: request.turnId, revision: request.revision, conceptId: request.concept.id,
    visibleText, sourceIds, nextAction, evidence: records, engineState: encodeState(state), pendingChallenge: Boolean(state.pending),
    status: state.statuses[request.concept.id] || 'explaining', character: 'neutral', ...extra,
  });
  const resolvePending = (studentCorrected: boolean, prefix: string) => {
    const pending = state.pending!;
    delete state.pending;
    const supported = state.support[pending.conceptId] && state.support[pending.conceptId] !== 'none' && state.support[pending.conceptId] !== 'question';
    state.statuses[pending.conceptId] = studentCorrected ? (supported ? 'explained-with-support' : 'explained-independently') : 'needs-another-pass';
    if (!studentCorrected) state.support[pending.conceptId] = 'explanation';
    records.push(evidence(request, state, studentCorrected ? 'corrected' : 'review', `${studentCorrected ? 'You clarified: ' : 'Review: '}${pending.correction}`, pending.sourceIds, pending.conceptId));
    return { text: `${prefix}${pending.correction}`, correction: { statement: pending.correction, sourceIds: pending.sourceIds, studentCorrected }, sources: pending.sourceIds };
  };

  // No network dependency can leave a false statement unresolved on exit or concept change.
  if (state.pending && (request.action === 'end' || request.action === 'skip' || request.action === 'explain' || request.concept.id !== state.pending.conceptId || request.settings.challenges === 'off')) {
    const resolved = resolvePending(false, 'Before we move on, the accurate version is: ');
    state.activeConceptId = request.concept.id;
    const next = request.action === 'end' ? 'recap' : request.action === 'skip' ? 'advance' : request.action === 'explain' ? 'explain' : 'invite';
    const question = next === 'invite' ? ` ${request.concept.question}` : next === 'explain' ? ' You can explain that distinction back in your own words whenever you’re ready.' : '';
    return result(resolved.text + question, next, resolved.sources, { resolvedCorrection: resolved.correction });
  }
  state.activeConceptId = request.concept.id;
  if (request.action === 'end') return result('Your recap keeps the explanations, corrections, and help you actually worked through. Pick up with the review items next time.', 'recap');
  if (request.action === 'skip') {
    state.statuses[request.concept.id] = 'needs-another-pass';
    records.push(evidence(request, state, 'review', `Return to ${request.concept.title}.`, request.concept.sourceIds));
    return result('We’ll keep this idea for another pass. You can choose the next concept when you’re ready.', 'advance');
  }
  if (request.action === 'start' && !state.pending) {
    state.statuses[request.concept.id] ||= 'explaining';
    return result(request.concept.question, 'invite');
  }
  if ((request.action === 'answer' || request.action === 'accept') && !request.text.trim() && request.action !== 'accept') return result('I didn’t catch an explanation yet. Type it here or record a short explanation, then review the transcript.', 'clarify');
  if (request.action === 'answer' && request.text.trim().split(/\s+/).length >= 5) state.substantialTurns++;
  const sources = relevantSources(all, request.concept, request.text, request.selection?.spanIds, state.pending?.sourceIds);

  if (state.pending && (request.action === 'accept' || request.action === 'hint' || request.action === 'source')) {
    const pending = state.pending;
    if (request.action === 'accept' && pending.attempts >= 1) {
      const resolved = resolvePending(false, 'There is one distinction to keep: ');
      return result(`${resolved.text} Try restating it with that condition included.`, 'explain', resolved.sources, { resolvedCorrection: resolved.correction });
    }
    if (request.action === 'accept') pending.attempts++;
    state.support[request.concept.id] = request.action === 'source' ? 'source' : 'hint';
    records.push(evidence(request, state, 'help', request.action === 'source' ? `Opened a supporting passage for ${request.concept.title}.` : `Used a focused hint for ${request.concept.title}.`, pending.sourceIds));
    return result(request.action === 'source' ? `Look at the highlighted passage. ${pending.hint}` : pending.hint, request.action === 'source' ? 'source' : 'hint', pending.sourceIds, { character: 'puzzled' });
  }

  const canChallenge = request.action === 'answer' && challengeIsAllowed(state, request.settings.challenges);
  const assessment = assessmentSchema.parse(await provider.assess({ request, state, sources, challengeAllowed: canChallenge }));
  requireReferences(assessment.sourceIds, sources);

  if (state.pending) {
    const pending = state.pending;
    if (assessment.correctionAccepted && assessment.judgment === 'correct') {
      const resolved = resolvePending(true, 'You caught the distinction. The accurate version is: ');
      return result(`${resolved.text} ${state.support[request.concept.id] ? 'Try applying that distinction to a fresh example.' : 'That correction is saved with its source.'}`, 'advance', resolved.sources, { resolvedCorrection: resolved.correction, character: 'pleased' });
    }
    if (pending.attempts >= 1) {
      const resolved = resolvePending(false, 'Let’s close the loop. The accurate version is: ');
      return result(`${resolved.text} You can give that idea another pass in your own words.`, 'explain', resolved.sources, { resolvedCorrection: resolved.correction });
    }
    pending.attempts++;
    state.support[request.concept.id] = 'hint';
    records.push(evidence(request, state, 'help', `Used a focused hint for ${request.concept.title}.`, pending.sourceIds));
    return result(pending.hint, 'hint', pending.sourceIds, { character: 'puzzled' });
  }
  if (request.action === 'hint' || request.action === 'source' || request.action === 'explain') {
    const support = request.action === 'explain' ? 'explanation' : request.action;
    state.support[request.concept.id] = support;
    records.push(evidence(request, state, 'help', `${request.action === 'explain' ? 'Read an explanation of' : request.action === 'source' ? 'Opened a source for' : 'Used a hint for'} ${request.concept.title}.`, assessment.sourceIds));
    return result(assessment.visibleText, request.action, assessment.sourceIds, { spokenText: assessment.spokenText || undefined });
  }
  // A binary confirmation is not a fresh explanation, even if a provider calls it correct.
  if (assessment.judgment === 'correct' && assessment.strength && request.text.trim() && request.action === 'answer') {
    const supported = state.support[request.concept.id] && !['none', 'question'].includes(state.support[request.concept.id]);
    state.statuses[request.concept.id] = supported ? 'explained-with-support' : 'explained-independently';
    records.push(evidence(request, state, 'explained', assessment.strength, assessment.sourceIds));
  } else if (assessment.judgment === 'partial' || assessment.judgment === 'incorrect') {
    state.statuses[request.concept.id] = 'needs-another-pass';
    if (assessment.gap) records.push(evidence(request, state, 'review', assessment.gap, assessment.sourceIds));
  } else state.statuses[request.concept.id] ||= 'explaining';

  if (assessment.challenge || assessment.nextAction === 'challenge') {
    const candidate = assessment.challenge;
    let approved = false;
    if (candidate && canChallenge && assessment.judgment === 'correct' && supportedQuote(candidate, sources)) {
      try {
        const verification = verificationSchema.parse(await provider.verify(candidate, sources));
        requireReferences(verification.sourceIds, sources);
        approved = verification.verdict === 'approved' && verification.sourceIds.every(id => candidate.sourceIds.includes(id));
      } catch { approved = false; }
    }
    if (candidate && approved) {
      state.pending = { ...candidate, conceptId: request.concept.id, attempts: 0 };
      state.lastChallengeAt = state.substantialTurns;
      return result(candidate.candidate, 'challenge', candidate.sourceIds, { label: 'Check my understanding', character: 'neutral' });
    }
    // A rejected candidate's text is never shown, even if the presentation fields repeated it.
    return result('Your explanation is saved. Which condition or limitation in this passage matters most to your reasoning?', 'follow-up', assessment.sourceIds);
  }
  return result(assessment.visibleText, assessment.nextAction, assessment.sourceIds, {
    spokenText: assessment.spokenText || undefined,
    ...(assessment.nextAction === 'paraphrase' ? { label: 'Check my understanding' as const } : {}),
    character: assessment.nextAction === 'paraphrase' ? 'neutral' : assessment.judgment === 'correct' ? 'pleased' : assessment.judgment === 'uncertain' ? 'puzzled' : 'neutral',
  });
}

/** Per-session request gate: a slower old completion cannot supersede a newer revision. */
export class RevisionGate {
  private latest = new Map<string, { revision: number; turnId: string; updated: number }>();
  begin(request: Pick<TurnRequest, 'sessionId' | 'turnId' | 'revision'>) {
    const previous = this.latest.get(request.sessionId);
    if (previous && (previous.revision > request.revision || (previous.revision === request.revision && previous.turnId !== request.turnId))) throw new ApiError(409, 'A newer turn replaced this request.', 'STALE_TURN');
    this.latest.set(request.sessionId, { revision: request.revision, turnId: request.turnId, updated: Date.now() });
    if (this.latest.size > 500) for (const [id, value] of this.latest) if (Date.now() - value.updated > 3_600_000) this.latest.delete(id);
  }
  assertCurrent(request: Pick<TurnRequest, 'sessionId' | 'turnId' | 'revision'>) {
    const latest = this.latest.get(request.sessionId);
    if (!latest || latest.revision !== request.revision || latest.turnId !== request.turnId) throw new ApiError(409, 'A newer turn replaced this response.', 'STALE_TURN');
  }
  remove(sessionId: string) { this.latest.delete(sessionId); }
}
