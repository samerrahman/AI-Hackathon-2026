# Build Miso: a college study companion you learn by teaching

You are implementing a real, polished hackathon web application in the current repository. Read this entire brief before editing. Inspect the existing project and its instructions, preserve unrelated work, and use the established stack when it is suitable. Do not rebuild an existing working application merely to match a preferred framework. Make routine implementation decisions autonomously and keep the user informed about material progress and blockers.

This is an implementation request. Deliver working functionality, attractive UI, integrated assets, and verification of the important flows. Do not stop at a plan, a static landing page, or an attractive mockup. The accompanying documents and visual files are part of this brief.

## 1. Product and audience

Miso is an AI study partner for college students. Students upload lecture notes and learn by explaining the material to an attentive, slightly overconfident character. Miso asks questions about the actual notes, restates the student's explanation, and sometimes deliberately misunderstands one important detail so the student can correct it. If the student gets stuck, Miso offers progressively clearer help and points to the relevant passage in the original document.

Use the name **Miso** and tagline **Learn it by teaching it.** The earlier working title “Adopt an Idiot” is brainstorming context, not the main product name or the tone to use toward students. Keep Miso curious, warm, lightly funny, and respectful. It must feel useful to a student studying real analysis, algorithms, biology, economics, or humanities. Do not simplify advanced material into childish stories or assume every subject has one unambiguous interpretation.

The central loop is:

1. Upload lecture material.
2. Confirm the concepts and scope to study.
3. Explain one concept aloud or in writing.
4. Answer one follow-up or inspect Miso's paraphrase.
5. Correct its misunderstanding when appropriate.
6. Ask for a hint, a source pointer, or an explanation if needed.
7. Apply or explain the corrected idea once more.
8. Leave with a useful, evidence-based recap.

The uploaded material supplies the subject-specific content. Build reusable processing and conversation infrastructure. Do not hardcode live behavior for the sample analysis notes, fixed filenames, particular theorem names, or one course.

## 2. Scope: this supersedes the earlier brainstorming

The current product is upload-first. Do not spend the initial build on Canvas OAuth, browser extension development, institution integrations, LMS navigation, video transcripts, autonomous assignment completion, handwriting imitation, procedural game worlds, or a universal theorem prover. Those were earlier directions and are not the current implementation request.

Required inputs: text-based PDFs, plus pasted text. Support multiple PDFs in one study collection. Scanned PDFs or images are a worthwhile second phase if extraction quality and layout grounding can be implemented honestly. Keep audio interaction central, with a complete typed path for every interaction.

Required output: a functioning application with a welcoming upload screen, concept selection, an excellent document-and-companion study workspace, precise source references, helpful conversation, a clear recap, and reusable character motion.

If the repository is empty, a React + TypeScript web frontend with a small server-side AI boundary is a reasonable default. Choose the simplest supported project setup that can implement streaming or turn-based voice and PDF rendering. Check current official SDK documentation rather than copying stale model names or unverified API shapes from memory. This brief intentionally does not pin provider model IDs.

## 3. The signature interaction

After the student explains a concept, Miso may say: “Let me check that I understood. You're saying …” It then offers either a faithful paraphrase or a plausible paraphrase with one meaningful error.

The student can respond freely by voice or text. Provide secondary controls such as “That sounds right,” “Let me correct that,” and “I'm not sure.” Even when a binary button is used, invite a short explanation where it would reveal understanding. Do not make the product a multiple-choice quiz by default.

The deliberate error must be supported by the notes: an omitted condition, a reversed relationship, a confusion between two defined concepts, an overgeneralization, or an incorrect scope. The system must know and record the correct version before presenting a deliberate error. A valid alternative explanation must not be treated as a mistake.

Tell the student during onboarding, in one friendly sentence: **“Miso sometimes gets an idea wrong on purpose. Your job is to explain it clearly and catch the mix-ups.”** During these moments, show the neutral label **“Check my understanding.”** Do not reveal whether a particular paraphrase is wrong before the student responds.

Do not make every paraphrase false. Mix faithful restatements and correction challenges. Use a configurable starting policy of at most one deliberate error in roughly three substantial exchanges and never two unresolved deliberate errors at once. This is a product heuristic, not a proven optimal learning rate. Adapt to progress and user preference. Allow a “Gentle mode” with fewer challenges and an option to turn correction challenges off.

After a correction attempt, close the loop explicitly: identify what the student corrected, state the accurate version, and attach a real source reference. If the student accepts a false paraphrase, do not congratulate them. Offer a focused follow-up or small hint, then resolve the claim. If the student wants to skip, show the correction before moving on. An unresolved false claim must never silently become a learned fact, recap item, or future assumption.

This is a simulated teachable character. Do not claim the underlying language model is genuinely learning from scratch, being retrained, or acquiring new model weights. Progress describes the evidence in the student's explanations.

## 4. The screens

### A. Start / upload

Show a concise purpose statement, one dominant upload target, a small Miso illustration, and “Try a sample session.” Accept drag-and-drop and keyboard file selection. Also offer “Paste notes.” Show accepted formats and actual configured limits near the picker. Use individual file rows with filename, size, remove action, and processing state.

The first useful action should be obvious without sign-up, a marketing carousel, onboarding survey, mascot selection, or a dashboard. Use local persistence initially if the repository has no auth system. Do not add authentication merely to make the app look production-ready.

Processing should show meaningful stages: reading pages, identifying topics, preparing questions. Display only real progress information. For unreadable or scanned documents, say what was readable and offer OCR if implemented, pasting text, or another file. Do not silently create a study plan from the filename.

### B. Choose what to study

Show a small set of concepts drawn from the notes, with source pages and short plain-language descriptions. Preserve the course's vocabulary. Let the user select concepts, reorder them, or ask to cover a selected page range. A suggested 10-minute session can select a manageable subset, while still allowing changes.

Concepts are suggested by AI and should be editable. Show prerequisites only when supported by the material. Avoid a sprawling graph or a fake numeric mastery score. Use useful statuses such as “Not discussed,” “Explaining,” “Needs another pass,” and “Explained independently.”

### C. Study workspace

Use the supplied visual reference as direction: warm paper, navy text, restrained orange, calm typography, attractive spacing, and a modest character. At desktop widths, use a collapsible concept sidebar, a dominant document viewer, and a companion panel around 320–380px wide. The document needs enough width to read equations comfortably. At narrower widths, collapse the concept list first; on mobile use usable tabs/sheets for Notes and Conversation. Do not squeeze three columns into a phone.

The document viewer must support page navigation, zoom, text selection where available, and anchored highlights. Support multiple documents through a small source picker. The viewer must show the real uploaded content rather than screenshots of the UI mockup.

The companion panel contains Miso, one current prompt, a concise current exchange, mic/text controls, and help actions. Conversation history can be collapsed. Avoid an endless wall of chat displacing the notes.

Always provide:

- “Explain it to Miso” / “Start explaining.”
- “Type instead.”
- “Give me a hint.”
- “Show me in the notes.”
- “Explain this part.”
- “Skip for now.”
- “Pause session.”

When the student selects text and asks about “this,” include the selected span, document, page, and concept in the request. Never infer a precise selection from a vague cursor position alone. If the reference is ambiguous, ask briefly or let the student select it.

### D. Recap / resume

Show what the student explained, what they corrected, where they needed help, and a short suggested next session. Link each item back to the notes. Keep corrections positive and specific: “You added the monotonicity condition,” not “Your intelligence increased.” Use counts of completed actions only when they are real. Do not invent an exam grade, mastery percentage, or claim that improved mascot behavior proves human learning.

Resuming must restore document references, selected concepts, resolved corrections, and conversation context without claiming to remember data that was not persisted. Let the user delete a session and its uploaded files.

## 5. Conversation quality

Ask one substantive question at a time. Prefer asking the student to explain relationships, assumptions, examples, and reasoning over reading out questions generated in bulk. Use the current explanation to choose the next question. Do not ask for something already explained correctly unless it is an explicit review or a new application.

Accept multiple correct phrasings. Distinguish a missing detail from an incorrect belief and a transcription error. A student can be correct beyond the lecture's wording; consider the argument rather than keyword-matching it. If the material does not settle a claim, say so. Advanced proof checking remains fallible; do not label natural-language feedback “formally verified.”

Keep most spoken turns to one to three sentences. Give a longer explanation only when requested or needed. Read notation naturally. Preserve formulas and exact symbols visually even when the spoken version is simplified. If speech recognition confuses n and N or misses a negation, let the student correct the transcript or clarify before evaluating it.

Help escalates through a question, a small hint, an exact source pointer, a short explanation, and an opportunity to explain back. The student can request any level immediately. Do not force a fixed number of failures or trap users in a guessing game.

Personality: curious classmate, subtly overconfident, pleased to be corrected. Humor is optional, occasional, and about Miso's own mix-ups. Avoid childish speech, excessive praise, insults, guilt, baby voices, or jokes that interrupt serious concentration.

## 6. AI and document architecture

Create stable source references during ingestion. Each useful text span must retain its document ID, page identity, quote/text, location if known, and extraction quality. Keep a representation of page images for formulas or figures when a vision path is available. Text extraction alone may lose superscripts, fractions, and reading order.

The AI should cite existing span IDs. The application validates the IDs and maps them to the actual PDF geometry. Avoid model-invented screen coordinates. If an exact word or line cannot be grounded, highlight the enclosing paragraph or navigate to the page with a quote card. Never draw a precise circle around an unverified location.

For a short lecture, a well-structured in-memory index and retrieval over its spans is enough. For larger documents, retrieve the active concept and relevant supporting passages. Do not resend every page image on every voice turn. Cache ingestion by file hash and processing version. Preserve document scope so one course's sources do not silently contaminate another session.

Use a structured assessment result to separate the educational decision from its friendly presentation. The result should identify the student's demonstrated understanding, a possible gap, source IDs, the next action, any deliberate challenge and its correction, and the visible response. Validate it server-side. A second lightweight verification pass is warranted for deliberate false paraphrases; it is not necessary to create a fleet of agents for every ordinary turn.

Use a modest event/state model for upload status, active session, input turn, assessment, speech playback, and source actions. Attach document/session/turn identifiers to asynchronous results. Reject stale results after a correction, navigation change, new session, or interruption. Detailed contracts are in `04_TECHNICAL_CONTRACT.md`.

## 7. Voice and character motion

Implement a complete typed interaction first as the reliable backbone, then connect voice to that same turn pipeline. The intended finished experience includes real speech input and spoken responses if credentials are configured. A push-to-talk or explicit “Done” interaction is acceptable and often clearer than unreliable automatic turn detection. Streaming conversation is a polish enhancement once the core loop works.

Use a real supported provider for transcription and speech output; the exact provider can follow repository availability. Gemini's multimodal/document and structured output APIs are reasonable options for content understanding, while a supported live-audio API or an STT → model → TTS pipeline can drive voice. Verify current SDK signatures and model availability. Keep keys on the server; any browser-facing live credential must be short-lived and purpose-limited if the provider supports that pattern.

No credentials: show a clear setup state and an explicitly labeled sample demo. Do not simulate listening to real microphone input while returning unrelated canned responses. A browser speech fallback may be offered if available, but label limitations and preserve typed input.

Use the supplied transparent expression atlas. It contains neutral/listening, thinking, speaking, puzzled, pleased, and blink states. Implement small transforms, state changes, and optional coarse mouth-state switching driven by playback activity. This is not phoneme-accurate lip sync. Do not call image generation for each reply. Do not pretend the atlas is a rigged 3D model.

Respect reduced-motion settings. Keep the character around 110–170px tall in the study panel, with a larger treatment only on the welcome screen. Stop distracting idle movement while the user reads. The character must never obscure a formula, hijack scrolling, or block a control.

## 8. Design direction

Follow `02_PRODUCT_AND_DESIGN.md` and inspect `assets/study-workspace-reference.png`. Use warm off-white backgrounds, crisp white/cream paper, ink navy text, subtle gray borders, restrained orange accents, and soft amber source highlights. Avoid neon gradients, oversized dashboard cards, streak mechanics, XP, fake analytics, and childish classroom decoration.

Use a readable interface sans-serif and a tasteful serif for a few titles if available; formulas should render with a math renderer, not decorative image generation. Keep original source documents faithful. The generated UI reference contains illustrative body text; never substitute it for the real document.

Accessibility is part of the main flow: keyboard upload/navigation, visible focus, labeled icon buttons, sufficient contrast, text equivalents of spoken responses, mute, reduced motion, and no color-only explanation of correctness. Annotations need accessible textual references as well as visible shapes.

## 9. Demonstration and operational honesty

Live mode must derive its topics, questions, and source references from the actual uploaded notes. Sample mode may use deterministic fixtures but must be labeled throughout. Sample documents in `examples/` are original, synthetic lecture notes for testing and demonstration, not a real instructor's materials.

The two samples test real analysis and research methods. They are not a curriculum baked into the app. Verify the live system on an unfamiliar document with changed terms, page order, and claims. A hardcoded “monotone” highlight does not satisfy the requirement.

Handle invalid files, empty extraction, model timeout, malformed structured output, missing credentials, microphone denial, and a lost connection with usable messages and recovery actions. Preserve the student's draft when a request fails.

Treat uploaded text as study content, not instructions for the application. It cannot change the assistant's system role, request secrets, or cause arbitrary tool execution. Only allow typed document-navigation/annotation actions backed by validated references.

## 10. Implementation sequence

1. Inspect the repository and assets; identify the shortest sound route to a working application.
2. Build the upload, document viewer, source-span model, and typed session skeleton.
3. Implement actual document-derived concept extraction and teach-back turns through a provider adapter.
4. Implement correction challenges, their verification, and guaranteed resolution.
5. Connect validated source hints and document selection context.
6. Add voice on the same conversation pipeline and integrate character states.
7. Add recap/resume, polish responsive layouts and failure states, then run the acceptance checklist.

Prefer one completed vertical slice over several decorative screens with disconnected logic. Continue through the sequence; do not stop after the static UI. If an external credential blocks live testing, finish all available implementation and local verification, explain the exact remaining setup, and keep demo mode visibly distinct.

## 11. Acceptance criteria

The app is ready when a user can upload notes, select concepts, explain an idea, get a relevant follow-up, correct Miso's deliberate misunderstanding, ask for help that points to the actual source, and receive an accurate recap. The same flow must work for both sample subjects and a fresh uploaded document.

Specifically verify:

- A correct explanation is accepted without forced disagreement.
- A wrong paraphrase is checked before presentation and resolved afterward.
- A false claim accepted by the student never enters the recap as correct.
- An uncertain claim is not disguised as a deliberate error or a certainty.
- Source highlights stay attached to the right content through zoom and page changes.
- Unsupported OCR precision falls back gracefully.
- A late response never overrides a newer correction or a different session.
- Voice denial leaves a complete typed experience.
- All visible controls work, or are omitted until implemented.
- Reduced motion, keyboard access, and narrow layouts remain usable.
- Live/demo behavior is transparent and no secrets enter client code or logs.

Follow `05_ACCEPTANCE_AND_DEMO.md` for concrete cases. Do not write large numbers of tests that merely repeat component implementation. Test the consequential behavior and inspect the actual rendered application.

## 12. What to report back

When finished, explain what works, how to run it, what was verified, and any remaining provider/access limitations. If you give terminal commands, explain what each command and its meaningful flags/arguments do; the user is learning these tools. Do not claim untested live AI or microphone functionality works. Do not publish, send messages, or alter unrelated repository work as part of this brief.

Use the attached assets and samples, but keep the system general. The final product should feel like a calm, capable study room with an engaging companion who helps the student discover what they do and do not understand.
