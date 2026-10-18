# Acceptance criteria, evaluation cases, and demo

## Definition of done

The user can upload real lecture notes, choose concepts, explain in voice or text, answer meaningful questions, inspect and correct Miso's paraphrase, request progressively clearer help, navigate to actual source evidence, and finish with a faithful recap. The application looks and feels polished on a laptop and remains usable on a narrow screen.

The character is part of the interaction, but working animation alone does not establish completion. A static screen with scripted responses does not satisfy live mode.

## Functional acceptance

| Case | Expected result |
| --- | --- |
| Upload one valid text PDF | Actual document renders; concepts reference its real content and pages |
| Upload several PDFs | Files stay distinguishable; session scope is clear; source citations identify the right file |
| Paste lecture text | Complete typed study flow works with text anchors rather than fake PDF pages |
| Remove a file before processing | Removed file does not enter the resulting session |
| Cancel processing | Late results do not open a canceled session |
| Partially unreadable PDF | Reliable content is usable; limitations are shown; no invented precise circles |
| Select a passage and say “this” | The selected span is used or the app asks for clarification |
| Zoom or rotate a page | Source highlights remain attached to the source content |
| Request a hint | One small relevant hint appears, with no forced full answer |
| Request a direct explanation | App explains immediately and does not insist on more failed attempts |
| Pause and resume | Context, pending challenge state, sources, and progress restore accurately |
| Delete a session/collection | Persisted content is removed as described by the product |

## Learning behavior acceptance

### A. Correct explanation

Student accurately explains that boundedness controls the range of sequence values and does not imply convergence. Expected: accept that distinction. Do not ask the student to repeat an identical explanation or pretend they omitted monotonicity from a claim they never made.

### B. Equivalent language

Student says “the terms never move downward” instead of “nondecreasing.” Expected: recognize the correct meaning. Do not demand vocabulary matching as the only evidence of understanding.

### C. Deliberate mistake corrected

Miso asks whether a bounded sequence must converge. Student identifies an alternating bounded sequence. Expected: acknowledge the correction, state the accurate relationship, cite the notes, and resolve the challenge. Save the corrected statement.

### D. Deliberate mistake accepted

Student says “yes” to the same false claim. Expected: no praise for correctness. Ask about oscillation or offer a source hint. Resolve the claim before ending or advancing. A recap must not say “bounded sequences converge.”

### E. Faithful paraphrase

Miso accurately restates a concept. Student agrees with a reasonable explanation. Expected: accept it. The system must not manufacture a hidden flaw because the product contains correction challenges.

### F. Ambiguous transcript

Speech transcription loses “not” in a statement or confuses n and N. Expected: clarification or editable transcript, not confident diagnosis of a conceptual gap.

### G. Unsupported challenge

The generator proposes a false paraphrase whose correction has no reliable source. Expected: reject it and use an ordinary question. Never display an unsupported falsehood just to satisfy a challenge cadence.

### H. User challenges Miso

Student offers a valid alternative argument or corrects an accidental AI error. Expected: reevaluate and acknowledge the correction when warranted. Do not retroactively call an accidental error intentional.

### I. Interpretation rather than fact recall

For interpretive course material, student offers a different thesis with evidence. Expected: assess the evidence and reasoning. Do not treat one model-generated thesis as the unique answer.

### J. Skip or end with an unresolved false paraphrase

Expected: show the accurate version in a short correction before completing the transition. Mark the concept for review if understanding was not demonstrated. Keep the final state resolved or explicitly visible, never silently discarded.

## Generalization tests

Use both supplied lecture fixtures. Then use a fresh, short document the implementation has never seen. Change wording, page order, headings, and examples. Verify that topics and hints follow the uploaded content.

Useful perturbations:

- Move the monotone convergence theorem to another page.
- Replace its example with a different bounded oscillating sequence.
- Upload research-methods notes and ask about random assignment.
- Upload a one-page text explaining a new concept and verify that the app does not mention sequences.
- Remove a source passage and verify that the app cannot still cite its old ID in a new session.

A developer may use deterministic model stubs to test state transitions. A real live run on unfamiliar material is still required to assess content generation. If credentials are unavailable, report that live verification remains incomplete.

## Annotation tests

- A source ID maps to the expected quote, file, and page.
- Duplicate phrases on the same page are disambiguated by their containing span.
- Wrapped-line quotes produce appropriate multiple rectangles.
- Zoom, resize, page virtualization, and rotation do not detach highlights.
- A text extraction failure falls back to a page reference rather than an invented box.
- Switching files while a source action is pending does not highlight an unrelated page.
- A challenge's answer is not highlighted automatically before the user asks for help.

## Voice and state tests

- Microphone denied: typed path works and the message gives a recovery action.
- Student stops recording: recording indicator stops and no hidden recording continues.
- User interrupts speech: playback and queued utterances stop.
- User revises an answer while assessment is pending: older response is rejected.
- Model timeout: draft and source selection survive.
- Malformed structured response: recover safely; no arbitrary tool/annotation action executes.
- Page hidden or session paused: unnecessary animation stops.
- Reduced motion: all interaction remains understandable with a static character.

## Visual review

Inspect the actual application at a normal laptop width, a smaller laptop/tablet width, and a phone width. Check the welcome screen, processing, setup, main study view, correction challenge, source hint, error state, and recap.

No clipped controls, tiny note text, overlapping mascot, orphaned headings, unreadable orange text, duplicate main actions, or transcript that pushes input off-screen. Keep the source viewer dominant. Test keyboard focus, tab changes, source navigation, and text draft retention.

The reference image is art direction. Do not reproduce its generated body text or treat it as source evidence. Use exact content from the actual PDF.

## A two-minute demonstration

This is a suggested script, not a hardcoded live response sequence.

1. **0:00–0:15:** State the problem: rereading can feel familiar without revealing what you can explain. Open the app and upload the sample lecture or a short fresh lecture.
2. **0:15–0:30:** Show the concepts grounded in the document. Select one and start explaining.
3. **0:30–0:55:** Give a mostly correct explanation. Let Miso ask a useful follow-up or offer a check-my-understanding paraphrase.
4. **0:55–1:20:** Correct the paraphrase or deliberately ask for help. Show a real source reference highlighting the relevant passage.
5. **1:20–1:40:** Explain again. Show that the next turn recognizes the correction rather than restarting.
6. **1:40–2:00:** Open the recap. Point out the actual corrected distinction and the next review item.

Have a text-only fallback ready for noisy venues. A prepared fixture demo must remain labeled. If live content extraction is slow, pre-process the sample visibly and use a short fresh document to show generalization separately.

## Technical story for judges

Explain the specific work: extracting lecture structure with source locations; controlling occasional verified correction challenges; preserving evidence across student attempts; mapping model-selected source IDs to actual document highlights; and coordinating speech, annotation, and state cancellation.

Avoid claiming universal proof verification, guaranteed learning gains, an entirely new learning theory, or a fully autonomous model learning from scratch. A small real evaluation is stronger: report how many annotation targets were correct, how many unsupported challenges were rejected, and what student feedback you actually collected. Do not invent metrics.

## Small pilot after the core build

If time permits, ask a few classmates to use one unfamiliar concept. Give a short explanation/application question before and a different comparable question after. Record observed usability issues and whether they could explain the distinction more clearly. Treat this as exploratory feedback, not proof of educational efficacy.

Prioritize fixing any case where the app falsely rejects a correct answer, leaves a deliberate falsehood unresolved, or points at the wrong source. Those failures matter more than adding another mascot animation.
