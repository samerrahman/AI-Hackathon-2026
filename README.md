# Miso — Learn it by teaching it.

A college study companion built for AI Hackathon 2026. Bring lecture PDFs or pasted notes, choose concepts, and explain them to Miso. It asks focused questions, checks its understanding, occasionally offers a verified correction challenge, and links help back to the original passage.

The app uses React, TypeScript, Vite, PDF.js, and a small Express API. The supplied character atlas and original synthetic lecture PDFs are integrated. No account is required and nothing is published automatically.

## Run locally

Use Node.js 22.13 or newer and npm. In this repository:

```sh
npm ci
npm run dev
```

`npm ci` installs the exact dependency versions recorded in `package-lock.json`. `npm run dev` starts both the API and Vite frontend; open **http://127.0.0.1:5173**. The API listens on loopback port 3001, and Vite forwards `/api` requests to it. Stop both with Ctrl+C.

Choose **Try a sample session** to use the app without credentials. Both the real-analysis and research-methods samples are original synthetic notes, not a real instructor’s course material. A persistent **Sample demo** badge identifies the deterministic fixture responses. The sample adapter recognizes a limited set of clear explanations and marks other wording unassessed; it does not pretend to judge arbitrary uploaded documents.

## Enable live study and voice

```sh
cp .env.example .env
```

This copies the configuration template into the local, Git-ignored `.env` file. Add `GEMINI_API_KEY` for live, document-derived concepts and conversation. Optionally add `OPENAI_API_KEY` for real transcription and AI-generated spoken responses. Restart `npm run dev` and reload the page after changing configuration. Model IDs and the speech voice are configurable in that file; keys stay on the server.

Microphone interaction is explicit: start recording, choose **I’m done**, review or edit the transcript, then send it through the same pipeline as typed input. A denied or unavailable microphone leaves the complete typed path available. Audio output can be muted. Credential presence means configured, not a verified provider connection; invalid keys, quotas, and model access failures produce recoverable messages.

Live AI and real microphone/provider playback have **not been exercised with credentials in this workspace**. Their adapters follow current official [Gemini generation documentation](https://ai.google.dev/api/generate-content), [OpenAI transcription documentation](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create), and [OpenAI speech documentation](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create). Actual model availability depends on the configured account.

## What is implemented

- Multiple text-based PDFs and pasted notes; editable concept selection and ordering; page-range scope.
- Original PDF rendering, selectable native text, page navigation, zoom, source picker, and normalized source highlights that move with the page. Pasted notes use section references.
- Typed teach-back turns; targeted hints, source pointers, direct explanations, correction handling, skip, pause, and recap.
- At most one deliberate challenge in three substantial exchanges, or six in Gentle mode. Challenges can be disabled. Every deliberate candidate requires a separate verification pass and a pre-recorded accurate correction. Uncertain candidates are rejected.
- Guaranteed resolution before skip, finish, or concept change. Accepting a false paraphrase produces help and then the accurate statement, never positive evidence for the false claim.
- One saved study session in this browser, including uploaded originals, references, draft, selected concepts, history, evidence, and private pending-challenge state. Resume restores that saved data. Starting a new collection replaces the current saved session. Settings includes deletion of the session and cached files.
- Responsive notes/conversation views, keyboard controls, text equivalents of audio, reduced-motion support, and supplied Miso expression states. Animation is coarse state switching, not phoneme-accurate lip sync.

## Limits and data handling

Collections accept up to five files, 20 MB and 100 pages per file, and 300,000 extracted characters in total. Recordings are limited to three minutes and 12 MB. Scanned-PDF OCR and image/vision interpretation are not implemented. Sparse or unreadable pages are reported; the app does not generate a course from a filename. PDF text extraction can lose mathematical layout, so inspect formulas against the rendered original. When exact geometry is unavailable, a source pointer uses the page and a quote instead of a precise-looking marker.

Documents and session data persist in IndexedDB. Live concept extraction sends extracted text to Gemini; live turns send relevant passages and recent conversation. Requested transcription sends audio to OpenAI, and speech output sends response text. Raw recordings are not saved by Miso. Provider account retention settings still apply; local deletion cannot retract already processed provider requests.

Pending correction answers are encrypted and authenticated in an opaque browser-persisted token. Its local server key is generated in `.miso/state-key`; keep that private key to resume across server restarts, or set a stable `SESSION_SECRET`. The server stores no lecture files or conversation database. See [server/README.md](server/README.md) for the API and state design.

## Build and verify

```sh
npm run check
npm test
npm run build
npm start
```

`npm run check` runs TypeScript without emitting files. `npm test` runs the consequential controller and document-source tests. `npm run build` checks types and produces the production frontend in `dist/`. After that build, `npm start` serves the built app and API together at **http://127.0.0.1:3001**.

Tests cover actual PDF extraction for both samples; source IDs and page identity; unfamiliar vocabulary through an injected provider; correct acceptance; challenge cadence and independent verification; accepted false claims; correction resolution during provider failure; encrypted resume and scope tampering; late response rejection; malformed provider output; and document geometry. The unfamiliar-document tests validate the infrastructure, not untested live model accuracy.

With the development server running, `npm run test:e2e` runs the browser flows using a temporary, isolated headless Chrome profile. The configuration uses an installed Google Chrome; change `channel` in `playwright.config.ts` if your environment uses a different supported browser. The ten browser tests cover sample sessions, correction and accepted-false resolution, source highlights and zoom, pause/refresh/resume, multiple uploads, invalid files, fresh pasted material, saved-data deletion, mobile tabs, reduced motion, simulated microphone denial, late transcription cancellation, stopping recording on typed submission, permission cancellation, and a delayed response interrupted by editing. Screenshots are saved in `artifacts/`. Real microphone capture and live provider accuracy remain unverified without credentials and device access.
