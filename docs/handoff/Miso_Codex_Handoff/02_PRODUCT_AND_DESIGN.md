# Product and design specification

## Product promise

Miso gives students a reason to explain their lecture material rather than passively reread it. The experience should feel like sitting beside an attentive classmate with the notes open between you. The classmate asks useful questions, occasionally mixes something up, accepts correction, and helps when needed.

Primary success: a student can identify and explain a distinction they previously missed. Secondary success: they want to return because the interaction is pleasant and the next session starts in the right place. Neither is established by decorative completion animations or by a model-generated mastery percentage.

## Interaction principles

1. The next action is obvious. There is one main prompt and one main response control.
2. The original material remains accessible. Help leads back to it.
3. Users control depth and pace. They can ask for an explanation immediately.
4. Challenges are constructive. Miso's intentional mistakes test ideas, not the student's patience.
5. Correctness takes priority over persona. Miso admits mistakes and uncertainty.
6. College content stays at college level. Preserve assumptions, nuance, and course vocabulary.
7. Personality is expressed through timing, brief language, and small movements.
8. Progress is concrete: explanations, corrected misconceptions, supported next steps.

## Screen 1: Welcome and upload

Header: small Miso wordmark, optional session-history link if history exists, accessible settings.

Main copy: **Learn it by teaching it.** Supporting sentence: **Bring your lecture notes. Explain the ideas to Miso, catch its mix-ups, and work through the parts that don't quite click.**

One large upload area with “Choose lecture notes” and “or drag PDFs here.” Show “Paste text instead” as a secondary action. A quiet “Try a sample session” link opens a chooser between the two included examples, explicitly labeled sample content.

After selection, show file rows, remove controls, and a single “Prepare my session” button. Multiple uploads belong to a study collection. Do not require the student to organize a course hierarchy before trying the app. Optional collection names can be suggested from document titles and edited.

First-use explanation: “Miso sometimes gets an idea wrong on purpose. Your job is to explain it clearly and catch the mix-ups.” Link a small “How it works” disclosure for students who want the details. Keep the main experience immediately usable.

## Processing states

Use an honest stage label and filename. If actual page counts are available, show them. If remaining time is unknown, do not display a precise countdown.

Examples:

- “Reading Lecture 04.pdf…”
- “Finding the main ideas…”
- “Some equations were hard to read. You can still use the document and choose the sections to discuss.”
- “This PDF looks scanned. Try OCR” only when OCR exists.
- “I couldn't extract enough text to prepare this document. Paste the notes or try another file.”

Users can cancel processing. A canceled or failed job must not later open an unexpected session. Processing several files should identify which files succeeded and let the user continue with those.

## Screen 2: Session setup

Title: **What would you like to teach today?**

Show 4–10 suggested concepts for an ordinary short lecture, grouped lightly by section. This range is a UI guideline, not a forced result count: a one-page note may have two concepts. Each concept has a short title, one-line description, and source pages. An edit control lets the student rename or remove a suggestion and add one of their own.

Choose a session length such as Quick pass, Standard, or Explore. Display approximate scope, not a guarantee of completion time. A “Start here” concept selection is more useful than a large preference survey.

Optional session settings: spoken responses on/off, correction challenges on/off, gentle/standard questioning. These should have good defaults and fit in a disclosure, not dominate setup.

The main action is **Start teaching**. Preserve selection if the user returns to this screen.

## Screen 3: Study workspace

### Desktop composition

- Top bar 56–64px: Miso wordmark, collection name, save/session status, quiet End session.
- Left sidebar about 200–240px, collapsible: document list and concept sequence.
- Center: real source viewer with readable page width, toolbar, page controls, zoom, and selection tools.
- Right companion panel about 320–380px: compact character, interaction label, current prompt, recent exchange, and response/help controls.

At roughly 1280px, prioritize the notes and companion. At smaller laptop widths, collapse the concept sidebar by default. Avoid fixed dimensions that force horizontal scrolling. Resizable panes are optional; sane default proportions matter more.

The supplied screenshot illustrates a source-hint moment after the student has asked for help. Its existing highlight and “missing condition” footer must not be shown before every correction challenge, because that would reveal the answer.

### The notes surface

Render the actual PDF, preserving its layout. Place application annotations in a separate overlay. Never overwrite or permanently mark the uploaded file unless the user explicitly requests export.

Selected text can reveal contextual actions: **Explain this**, **Let me teach this**, **Ask me about this**. A source citation can scroll to its page and reveal a temporary highlight. If navigation would move the student away from another passage they are reading, offer a clear “Go to source” action rather than repeatedly hijacking the viewport.

Circle short hypotheses only when their exact bounds are known. Highlight a line or paragraph when that is the available precision. For ambiguous extraction, show a quote card and page number. Multiple references should be selectable rather than flashing several areas at once.

### The companion panel

Character: about 110–170px tall, centered or slightly offset; it should fit above the prompt without pushing the response control out of view. On a short screen, shrink or collapse the mascot.

Interaction labels: **Your turn to teach**, **A quick question**, **Check my understanding**, **Let's look at the notes**, **Try it once more**. Labels describe the task. Do not display internal model/evaluator status.

The current question is the most readable text in the panel. Most model responses should fit in two to six short lines. Long explanation text is expandable or scrolls in a clear region while the input remains reachable.

One response area supports both modes:

- Voice: Start explaining / Listening… / I'm done / Cancel.
- Text: a multiline editor, Send, and an optional formula-friendly input path.
- After voice recognition: editable transcript or a clearly available correction action.

Separate **Listening** (student microphone), **Thinking** (model processing), and **Speaking** (audio playback). Never show listening when the microphone is not active. Always provide Stop speaking and mute.

Help controls remain predictable: Give me a hint; Show me in the notes; Explain this part. Put Skip for now in a quiet but visible location. Do not reorder the controls during a session.

### Responsive behavior

Tablet: use two panes with the source/concept navigation in a drawer.

Phone: use Notes and Conversation tabs with persistent session controls. Source links switch to the relevant note and include an easy Back to conversation action. Preserve text drafts when switching tabs. Keep touch targets comfortable and avoid hover-dependent controls.

## Screen 4: Recap

Title: **Here's what you worked through.**

Three useful groups, shown only when populated:

- Explained independently.
- Worked through with help.
- Worth revisiting.

Include concise evidence: “You distinguished a convergent subsequence from convergence of the whole sequence.” For a deliberate challenge, record the corrected proposition, never the false version as a standalone takeaway.

Offer **Review this concept**, **Continue next time**, and **Start another session**. A source-linked plain-text export is optional. Avoid a large celebratory screen that hides unresolved concepts.

## Visual system

Use these as design tokens, adjusting for measured contrast:

| Role | Suggested value |
| --- | --- |
| Application background | `#F6F3EE` |
| Paper / main surface | `#FFFEFB` |
| Strong text / primary button | `#18243D` |
| Secondary text | `#596273` |
| Border | `#DDD8D0` |
| Accent, icons, active marker | `#C65A2E` |
| Amber source highlight | `#FFE2A0` with appropriate opacity |
| Positive status | `#2F6B58` |
| Error/status caution | `#A43D35` |

Use a consistent 4/8px spacing scale with generous 16/24/32px groups. Main panel corners around 12–18px, smaller controls around 8–12px. Keep shadows subtle. Avoid making every row a floating card.

UI typography: a readable sans-serif such as a locally available system stack; a restrained serif can be used for selected headings. The original PDF keeps its own typography. Math rendering uses proper typesetting for generated formulas. Do not replace mathematical notation with a raster image unless it is part of the original scanned source.

The screenshot uses more serif typography and a larger mascot than may be ideal at every screen size. Treat it as art direction, not an exact pixel contract. The written requirements control behavior and accessibility.

## Motion specification

Use the atlas as discrete expression states, not a smoothly articulated face. Stable placement is more important than frequent expression changes.

| State | Expression / motion |
| --- | --- |
| Idle | Neutral, almost still; optional occasional blink while the session is active |
| Listening | Attentive expression, one slight head/body tilt when recording begins |
| Thinking | Thinking frame; tiny finite settle motion, separate textual processing indicator |
| Speaking | Speaking frame, optionally alternate mouth-open/neutral coarsely using playback activity |
| Check my understanding | Neutral or thinking; avoid a tell that reveals whether the paraphrase is false |
| Source hint | Look/tilt toward notes; animate source highlight once |
| Correction accepted | Pleased expression and a small single nod/bounce |
| Paused | Neutral still frame |

Suggested transforms: 1–3px translation and 1–3 degrees rotation, with transitions around 150–250ms. Keep whole-body motion subtle. The avatar should not bounce continuously as the student reads. No glitter, confetti, screen shake, or punishment animation.

Respect `prefers-reduced-motion`: remove movement and keep state text. An expression change may remain if it is not flashing. Stop animation when the page is hidden or the session is paused. The supplied image is not a viseme set; call the mouth motion “speaking animation,” not accurate lip sync.

## Microcopy and tone examples

Good opening: “Let's start with the main idea. How would you explain boundedness to someone who has seen sequences but not this definition?”

Good paraphrase: “Let me check that I understood: boundedness alone is enough for convergence?”

Good correction response: “You're right—the monotonicity condition was missing. A sequence can stay bounded and still oscillate.”

Good uncertainty: “I may be reading that symbol incorrectly. Is that n or N?”

Good help: “Let's look at the theorem statement. What condition appears beside boundedness?”

Good acceptance: “That explains both the condition and why it matters. Let's try a nearby example.”

Avoid: “Wrong!”, “Your IQ went up,” “I am genuinely learning new model weights,” “Obviously,” “You're a genius,” or “You failed again.”

## Accessibility and error design

Visible focus, semantic buttons, keyboard navigation, sensible headings, accessible names for icon controls, and text versions of audio are required. A source highlight should also produce a descriptive source chip such as “Lecture 04, page 3: monotone.” Do not announce every animation frame to a screen reader.

Maintain at least standard readable contrast, including orange labels on warm surfaces. Decorative orange is not automatically readable body text. Provide text alternatives to waveform-only recording feedback. Keyboard shortcuts must not conflict with typing formulas.

For failures, say what happened and what the user can do. Preserve drafts and uploaded source context. Never show a generic crash screen for a rejected microphone permission. Do not imply that a stalled provider is the student's fault.
