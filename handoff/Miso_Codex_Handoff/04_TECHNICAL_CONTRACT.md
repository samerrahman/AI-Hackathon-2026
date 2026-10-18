# Technical implementation contract

This specifies responsibilities and data relationships, not a mandatory directory structure or provider SDK. Adapt it to the repository. Prefer one small, coherent application over unnecessary infrastructure. No application source code is included in this handoff.

## 1. System responsibilities

| Part | Responsibility | Main failure to prevent |
| --- | --- | --- |
| Upload/ingestion | Validate files, preserve originals, extract reliable content and source locations | Inventing a lesson from unreadable content |
| Study index | Store concept-to-source relationships and retrieve relevant passages | Losing conditions or mixing documents |
| Conversation controller | Track the active concept, attempts, pending challenges, and help level | Repetitive questioning or unresolved false claims |
| Model adapter | Produce structured assessments and conversational responses | Invalid output reaching the UI unchecked |
| Source action executor | Navigate, highlight, or point using validated source references | Precise-looking but incorrect annotations |
| Voice adapter | Capture speech, transcribe, play responses, and cancel safely | Assessing stale or misheard speech |
| Character component | Map session/audio state to supplied expressions and motion | Decorative state disagreeing with actual recording/playback |
| Persistence | Restore session evidence and document references | False claims reappearing as learned facts |

These can be modules in one application. They do not need to be separate services or separate autonomous agents.

## 2. Recommended baseline

Use the existing frontend and backend if present. For a new project, React with TypeScript, a supported build tool, and a small server boundary for provider calls is sufficient. Use a maintained PDF renderer such as PDF.js or a compatible wrapper; inspect actual APIs and coordinate conventions. Use a math renderer for generated notation.

Keep provider-specific code behind adapters. Text generation, document vision, speech recognition, and speech synthesis may come from one provider or several, but avoid introducing extra vendors without a benefit. Configure model IDs in environment/server configuration and verify availability. Never copy a speculative future model name into the implementation.

For an initial single-user application, SQLite or the existing database can store session metadata; files can use the repository's storage approach. IndexedDB can support browser-local sessions when appropriate. Avoid localStorage for large documents. Clearly define what persists across refresh and what is deleted when the user removes a session.

A vector database is optional. For short lectures, a compact span index and targeted context retrieval are adequate. Add embedding search only when it improves retrieval across larger collections. Complexity should solve an observed problem.

## 3. Core data objects

These are conceptual field contracts. Codex should define and validate concrete types.

### Document

- `documentId`: stable application-generated ID.
- `collectionId`: study collection association.
- `filename`, `mimeType`, `byteSize`, `contentHash`.
- `pageCount`, `processingVersion`.
- `status`: uploaded, processing, ready, partial, failed, canceled.
- `extractionWarnings`: page-specific issues, not a hidden global confidence claim.
- Original file location and derived content locations.

### SourceSpan

- `spanId`, `documentId`, internal `pageIndex` (zero-based).
- `displayPageNumber` or document page label; do not confuse with `pageIndex`.
- `text`, optional exact quote range within the text.
- `kind`: paragraph, heading, equation, caption, table region, figure region, page region.
- `location`: one or more rectangles in a declared canonical page coordinate system, or null.
- `pageWidth`, `pageHeight`, `pageRotation` and required transformation information.
- `extractionMethod`: native text, OCR, vision-assisted, user-supplied.
- `locationPrecision`: word, line, paragraph, page, unknown.
- Reliability notes when a formula or reading order is uncertain.

Do not assume every sentence is one rectangle. Wrapped text can have multiple rectangles. Do not assume a PDF's origin matches browser coordinates. Choose one canonical convention and convert through the renderer's viewport transform.

### Concept

- `conceptId`, `collectionId`, title, short description.
- `learningGoal`: what the student should be able to explain.
- `sourceSpanIds`.
- Optional supported prerequisite concept IDs.
- Student-visible qualitative progress state.
- `evidenceIds`, not merely a model-generated score.

### Session

- `sessionId`, `collectionId`, chosen concept IDs and order.
- Active concept, selected source, current page/selection context.
- Settings: audio output, correction challenges, challenge intensity, reduced motion preference.
- Conversation turns, evidence records, pending challenge ID, recap.
- Status: active, paused, completed.
- Persistence timestamps and schema version.

### LearnerTurn

- `turnId`, `sessionId`, `revision`.
- Input mode: text or voice.
- Submitted text, optional editable transcription information.
- Active document/page/span selection at submission time.
- Active concept and any challenge being answered.
- Cancellation/superseded status.

### AssessmentResult

- Matching session/turn/revision identifiers.
- `interpretation`: concise account of what the student said, not hidden reasoning.
- `supportedStrengths`: specific demonstrated points plus evidence.
- `possibleGaps`: each with reason, source IDs, and uncertainty notes.
- `nextAction`: an allowed action from the teaching policy.
- `visibleText`, optional `spokenText` preserving mathematical meaning.
- `sourceActions`: references to existing sources only.
- Optional proposed challenge object.
- `progressUpdates`: evidence-backed changes only.
- Suggested character state from a small enum; the client still controls actual audio states.

### Challenge

- `challengeId`, `conceptId`.
- `type`: faithful or deliberate_error.
- Candidate paraphrase, correct statement, and exact distinction.
- Supporting source IDs and optional exact quotes.
- Verification state: approved, rejected, uncertain.
- Resolution: awaiting_response, hint_given, resolved, revealed_after_skip.
- Student response/evidence and final accurate takeaway.

Do not send private answer fields to a UI component that accidentally renders them before the response. Keep them available to the controller/server. This is ordinary separation of exercise content from its answer key.

### EvidenceRecord

- Related concept, student turn IDs, and source IDs.
- Demonstrated reasoning or remaining gap.
- Help level: none, question, hint, source_pointer, direct_explanation.
- Whether the student later applied the idea independently.
- Superseded/revised status if a later turn changes the assessment.

## 4. Ingestion pipeline

1. Validate the accepted type and configured size/page limits.
2. Save the original and compute a content hash.
3. Extract text and layout from the file. Keep page boundaries and source IDs.
4. Identify weak extraction: sparse text, broken formula order, or image-only pages.
5. Where available, use page images and a vision/OCR path to recover content. Retain uncertainty; do not fabricate precise boxes.
6. Build spans and a compact document outline.
7. Ask the model for grounded concept suggestions referencing the span IDs.
8. Validate source references and expose the editable outline.
9. Cache results keyed by file content and processing version.

For a partial document, show which pages are available. Let the user exclude unreadable pages. Keep already-processed files usable if another file fails. Cancellation must invalidate both the background job and its later UI result.

## 5. Turn pipeline

1. Capture user text or obtain an editable voice transcript.
2. Record the selected passage and active concept at submission.
3. Retrieve relevant source spans and the small amount of recent evidence needed.
4. Build the prompt with system policy, selected-source context, session state, and the learner's turn.
5. Request a structured result.
6. Validate identifiers, enums, source IDs, source quote matches, and allowed actions.
7. If a deliberate challenge is proposed, verify its factual distinction and ensure there is no unresolved challenge.
8. Commit the result only if the session, turn, and revision remain current.
9. Render the response and execute validated source actions at the appropriate moment.
10. Play audio if enabled; keep visible text available.
11. Persist evidence, challenge state, and any corrected knowledge.

A new user correction, user interruption, or session change invalidates stale work. The controller can use abort signals for requests and playback, plus identifier checks for responses that cannot be canceled upstream. Cancellation is not just an animation change.

## 6. Source actions

Allowed actions can include:

- Navigate to a document/page.
- Highlight one or more known source spans.
- Point to a known region.
- Show a quote card with its page reference.
- Clear a temporary annotation.

Resolve all geometry in the application. A model cannot request arbitrary JavaScript, CSS selectors, file paths, URL navigation, or generated code execution through this interface. A source action on a document outside the active collection must be rejected unless the user explicitly added it.

For native text, map quotes to text items using exact and normalized matching while preserving the original reference. Normalization must not erase a mathematically meaningful negation or distinction. If there are several matches, disambiguate using the containing span/page; do not choose a random occurrence.

Store PDF-space positions and recalculate viewport positions after zoom, resize, rotation, and virtualized page mounting. Do not store client pixel coordinates as durable source references. Test wrapped lines and multi-rectangle selections.

When location precision is unknown, use a page-level reference and quote. A broad honest pointer is preferable to a falsely precise circle. Tell the student if a formula was hard to read.

## 7. Voice behavior

Start with explicit turn control: press Start explaining, speak, press I'm done. Add automatic turn detection only if it behaves well with pauses during mathematical reasoning. Keep a clear recording indicator and a Cancel action.

Speech-to-text can fail on mathematical notation, abbreviations, and proper names. Preserve a text correction path. Do not infer a misconception solely from a suspicious transcript. Ask a short clarification when the issue affects the educational judgment.

For synthesized audio, keep spoken language natural while showing exact formulas in the panel. Avoid reading raw LaTeX commands aloud. Prefer a concise speech version of long equations, with the full expression visible.

On interruption, stop audio promptly, clear queued utterances, return the character to listening/neutral as appropriate, and invalidate pending actions tied to the interrupted response. Do not resume old speech automatically after a new answer.

Do not mix speaker audio into microphone input where it can be avoided. Provide headphones guidance only if echo is actually a problem. Avoid unnecessary audio processing scope for the prototype.

## 8. Character implementation

Read `assets/asset-manifest.json`. The supplied atlas has three columns and two rows. Use one cell at a time via a clipping viewport, CSS background positioning, or a canvas texture region. Copy the atlas unchanged into the project's asset system; no server-side image generation is required at runtime.

Keep the apparent body size and position stable across cells. The generated cells are close but not perfectly rig-aligned; minor visual offsets may need client-side presentation adjustment. Do not claim seamless skeletal animation. A neutral still frame is a valid reduced-motion state.

Character state must never overrule actual microphone/playback status. A provider timeout should show a calm recovery message rather than an endless speaking animation. Keep a text status independent of the mascot.

## 9. Persistence and data handling

Store only data required for the session. Do not retain raw voice recordings by default after transcription unless the product explicitly implements and explains that feature. Document provider processing and deletion behavior accurately in a small settings/help view. Do not claim uploads never leave the device if they are sent to a provider.

Keep credentials server-side. Avoid logging complete uploaded lectures, tokens, or raw recordings in ordinary application logs. Uploaded notes cannot alter system instructions. These are implementation basics, not a long user-facing compliance flow.

Deleting a study collection should remove its original files, derived content, and associated sessions according to the actual storage architecture. If provider-side deletion is separate, document and implement the supported behavior honestly.

## 10. Live and sample modes

Live mode uses a configured provider and the actual selected source material. Sample mode uses the bundled sample documents and fixtures, with a persistent “Sample demo” indicator. Sample behavior must not appear to evaluate an arbitrary uploaded document.

If a live call fails, preserve the input and offer Retry or Continue typing. Do not silently switch to a prewritten answer. If microphone support is missing, the complete typed flow remains available.

Fixture responses can make development and tests repeatable. Keep them in test/demo adapters, not the production decision path. Changing the sample PDF's theorem should change live questions and references.

## 11. Meaningful technical depth

The valuable engineering is source-grounded dialogue, validated correction challenges, precise document actions, evidence across attempts, and interruption-safe voice/state coordination. Do not add a graph database, multi-agent framework, formal prover, or elaborate game engine solely to sound advanced.

A concise, defensible technical demo can show the source ID behind a highlight, the saved correction after a challenge, and how the controller rejects a stale response. These demonstrate real implementation without exposing internal machinery to ordinary students.

## 12. Provider documentation

See `SOURCES.md` for official references on PDF rendering, multimodal document input, structured output, and live tool use. The docs were checked during preparation, but Codex should verify current SDK signatures and model access in the actual environment. Structured output validates shape; it does not establish semantic truth.
