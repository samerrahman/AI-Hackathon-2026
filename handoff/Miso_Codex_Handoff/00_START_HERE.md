# Miso — Codex handoff

Prepared for Henry / James Qiu's college AI hackathon project, October 17, 2026.

## The product in one paragraph

Upload lecture notes, choose what to cover, and teach Miso the main ideas in your own words. Miso listens, asks targeted questions, and sometimes offers an intentionally imperfect paraphrase for you to correct. When you need help, it points to the relevant passage in the notes and explains just enough to get you moving. You finish with an honest recap of what you explained independently and what needs another attempt. The experience is designed for college students and works from uploaded material rather than subject-specific scripts.

## What to give Codex

Extract this entire folder into your project directory, then paste this instruction into Codex:

> Read `Miso_Codex_Handoff/01_CODEX_BUILD_PROMPT.md` completely, then read its companion specifications and inspect the supplied visual assets. Implement this product in the existing repository, respecting its instructions and current stack. Start by making the upload → concept selection → teach-back → check-my-understanding → source hint → recap flow work end to end. Use the attached assets, preserve the college-level tone, and follow the live-versus-demo distinction. Proceed with reasonable implementation choices and verify the actual user flows.

If you can attach only one text file, attach `01_CODEX_BUILD_PROMPT.md`. It includes the essential product and implementation requirements. Attach the images as well if possible. The supporting documents give Codex more exact guidance.

If the folder is attached elsewhere, tell Codex its actual path. No terminal commands are required to use this pack.

## Files

| File | Purpose |
| --- | --- |
| `01_CODEX_BUILD_PROMPT.md` | The master implementation prompt. Read this first. |
| `02_PRODUCT_AND_DESIGN.md` | Screens, controls, visual design, accessibility, microcopy, and motion. |
| `03_LEARNING_BEHAVIOR_AND_PROMPTS.md` | The teaching loop and runtime prompt templates. |
| `04_TECHNICAL_CONTRACT.md` | Architecture, data contracts, grounding, audio, cancellation, persistence, and failure handling. |
| `05_ACCEPTANCE_AND_DEMO.md` | Completion checklist, behavioral tests, and a judge-friendly demo. |
| `assets/ASSET_GUIDE.md` | How to use the character atlas and screen reference. |
| `assets/asset-manifest.json` | Actual image dimensions and atlas cell coordinates. Data only. |
| `assets/GENERATION_PROMPTS.md` | Image provenance and prompts for future matching assets. |
| `assets/miso-expression-atlas.png` | Six transparent expression cells for code-driven animation. |
| `assets/study-workspace-reference.png` | Illustrative visual direction for a study session. |
| `assets/miso-character-concept.png` | Original mascot identity reference. |
| `examples/Sequences_and_Convergence.pdf` | Four-page original real-analysis lecture fixture. |
| `examples/Experiments_and_Causal_Claims.pdf` | Two-page original research-methods fixture to test transfer across subjects. |
| `examples/LECTURE_TEXT.md` | Accessible text of both sample lectures. |
| `examples/SESSION_EXAMPLES.md` | Example teaching, correction, hint, and recovery conversations. |
| `SOURCES.md` | Official implementation references checked while preparing the brief. |

## Decisions already made

- Product name: **Miso**. Tagline: **Learn it by teaching it.**
- Target: college students studying their own lecture material.
- Current scope: upload-first. Canvas login, a browser extension, video ingestion, and LMS navigation are deferred. This supersedes the earlier Canvas-first brainstorming.
- Primary interaction: explain aloud or type; respond to one focused question at a time.
- Distinctive interaction: Miso checks its understanding with a paraphrase that may contain a single, deliberate, source-checkable mistake.
- Character art supports the interaction. The lecture material stays visually dominant.
- The packet contains specifications, prompts, image assets, and sample documents. It contains no application implementation.

## What the assets do and do not provide

The atlas is a real PNG with transparency and six expressions. It supports sprite-state switching and subtle transforms. It is not a rigged 3D model, a finished animation, a phoneme/viseme set, or an accurately lip-synced video. Codex should implement restrained animation around these assets.

The interface image is a visual reference. Implement its components as actual UI; do not use the image as the working screen. Its generated body text is not authoritative course content. Use the source PDF's real content and the written specification.

## Completion standard

A fresh uploaded lecture must drive the session. Clicking through a prewritten demonstration is not sufficient for live mode. With credentials absent, the app should explain setup clearly and provide an explicitly labeled sample demo. It should never imply it has read an arbitrary upload when it is running a canned conversation.
