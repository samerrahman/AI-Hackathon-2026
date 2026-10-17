# Stu — Learn it by teaching it.

A college study companion built for AI Hackathon 2026. Bring lecture PDFs or pasted notes, choose concepts, and teach Stu: an earnest, slightly confused classmate who gradually gets it. Stu reacts to your explanation, asks about one concrete confusion, remembers resolved corrections, and uses source passages when either of you needs help.

The app uses React, TypeScript, Vite, PDF.js, and a small Express API. The supplied character artwork and original synthetic lecture PDFs are integrated. No account is required, and nothing is published automatically.

## Run locally

Use Node.js 22.13 or newer and npm. In this repository:

```sh
npm ci
npm run dev
```

`npm ci` installs the exact dependency versions in `package-lock.json`. `npm run dev` starts the API and Vite frontend; open **http://127.0.0.1:5173**. The API listens on loopback port 3001, and Vite forwards `/api` requests to it. Stop both with Ctrl+C.

## Firebase Hosting preview

The dedicated Firebase project is `ai-la-hackathon-2026`. Its Hosting site serves a static preview at **https://brodidnot.study** (also available at `https://ai-la-hackathon-2026.web.app`). The custom domain and Porkbun DNS records are documented in [docs/DOMAIN.md](docs/DOMAIN.md). Build and deploy the site with:

```sh
npm ci
npm run build:hosting
npx firebase-tools deploy --only hosting --project ai-la-hackathon-2026
```

Hosting serves the Vite `dist/` output. In this preview, visitors can open and read notes in their browser. Interactive study, sample sessions, and voice are unavailable because they use the Express `/api` server, which has not been deployed. The regular `npm run dev` and `npm run build` flows still use that server locally. No Firebase Auth, database, or Storage service is enabled for this preview.

Choose **Try a sample session** to use typed study without credentials. The real-analysis and research-methods samples are original synthetic notes, not a real instructor’s material. A persistent **Sample demo** badge identifies deterministic fixture responses. The sample adapter recognizes a limited set of explanations and leaves unfamiliar wording unassessed; it cannot evaluate arbitrary uploaded documents.

## Connect StepFun

For a new checkout, copy `.env.example` to the Git-ignored `.env` file. Preserve an existing `.env`. Configure the following server variables:

```dotenv
STUDY_PROVIDER=stepfun
STEPFUN_API_KEY=your-key-here
STEPFUN_MODEL=step-3.7-flash
STEPFUN_REASONING_EFFORT=low
STEPFUN_BASE_URL=https://api.stepfun.ai/v1
VOICE_PROVIDER=stepfun
STEPFUN_TRANSCRIBE_MODEL=stepaudio-3-asr-max
STEPFUN_TTS_MODEL=stepaudio-3-tts
STEPFUN_TTS_VOICE=vibrant-youth
STEPFUN_AUDIO_LANGUAGE=en
```

Restart `npm run dev` and reload the page after configuration changes. One StepFun key serves text and audio. Keys stay on the server; never put them in variables beginning with `VITE_`. No other provider account or balance is needed. Setting `VOICE_PROVIDER=off` disables audio while retaining typed study.

Use the base URL for the account that issued the key. The global platform uses `https://api.stepfun.ai/v1`; Step Plan documentation specifies `https://api.stepfun.ai/step_plan/v1` for plan audio. `STEPFUN_AUDIO_BASE_URL` optionally overrides the shared base for audio when the account requires a different endpoint. Do not switch account regions merely to bypass an access error. Model names and the preset voice are configurable. Credential presence means configured, not verified access to every model.

The text adapter uses StepFun’s [Chat Completions API](https://platform.stepfun.ai/docs/en/api-reference/chat/chat-completion-create), [structured output](https://platform.stepfun.ai/docs/en/guides/developer/json-mode), and [streaming protocol](https://platform.stepfun.ai/docs/en/guides/developer/stream). Uploaded notes are study data, never application instructions; no browsing or code-execution tools are exposed to them. Invalid keys, quota, model access, malformed responses, interrupted connections, and timeouts produce recoverable messages. Files remain available after preparation fails; drafts remain available after a failed turn.

## Teaching and voice

- Upload multiple text-based PDFs or paste notes. Edit, add, select, and reorder concepts, or choose a page range.
- Read the original PDF with selectable text, page navigation, zoom, a source picker, and grounded highlights. Pasted notes use section references.
- Explain by typing or microphone. Stu can understand correctly without asking another question, make a focused connection, or offer a verified correction challenge. Hints, source pointers, direct explanations, skip, pause, and recap remain available.
- The microphone starts only when activated. Stop recording to place the transcript in an editable composer; it is never sent automatically. Recording can be canceled, and permission denial leaves typed chat available.
- Enable **Spoken responses** to hear replies. Preview the voice, replay a reply, or stop playback. The full text stays visible. Starting the microphone or leaving a session cancels playback and pending audio. The character speaks only during actual playback.
- Microphone audio is encoded as genuine PCM WAV for StepFun. The backend rejects unsupported or falsely labeled audio. Speech uses the documented [ASR JSON/SSE endpoint](https://platform.stepfun.ai/docs/en/api-reference/audio/asr-sse) and [TTS endpoint](https://platform.stepfun.ai/docs/en/api-reference/audio/create-audio). There is no silent browser-speech or alternate-provider fallback.

Stu’s spoken delivery uses the `vibrant-youth` preset with a conversational instruction. Mathematical symbols, grouping, and explanatory parentheses are prepared for speech: StepFun otherwise treats parenthetical text as unspoken delivery instructions. The displayed reply remains authoritative for notation; speech normalization is conservative, not a universal mathematical reader. Native hands-free Realtime voice is a subsequent enhancement.

Every deliberate misconception needs an accurate source-backed correction recorded first and a separate verification pass before presentation. Standard mode allows at most one in three substantial exchanges; Gentle mode allows at most one in six. Challenges can be disabled. Pending misconceptions are resolved before skipping, finishing, or changing concepts. Accepting a false paraphrase never records the false claim as understood. This is fallible educational model review, not formal proof verification.

## Streaming, memory, and latency

Ordinary turns use one primary model call. The browser shows the submitted message immediately and renders arriving reply text over an end-to-end SSE connection. Reasoning chunks, private assessment fields, and raw JSON never appear in the chat. Deliberate challenge candidates remain withheld until their independent verification completes; they may therefore take longer than an ordinary response. Text rendering does not wait for speech generation.

PDFs are extracted once and cached locally by hash and processing version. A bounded, session-scoped server cache keeps extracted sources so subsequent turns send a collection reference instead of the whole collection. The provider receives only retrieved passages, recent messages, and compact source-backed memory. That memory distinguishes what you explained, resolved corrections, and an unresolved challenge; it never treats roleplay mistakes as learned facts. An expired server cache is restored from the saved browser data.

Numeric turn diagnostics distinguish submission-to-receipt time, context preparation, first provider chunk, first visible reply, full completion, model-call count, and token usage when reported. The browser emits these in a `stu:turn-timing` event without lecture text or credentials. A first reasoning chunk is not counted as visible reply text.

One synthetic chemistry explanation was measured locally before and after the change:

| Configuration | First reply text | Complete response |
| --- | ---: | ---: |
| Previous buffered response, Step 3.5 Flash | 15.437s | 15.437s |
| Streaming, Step 3.5 Flash | 10.886s | 11.708s |
| Streaming, Step 3.7 Flash, low reasoning | 4.346s | 5.300s |

These are individual runs, not statistical benchmarks or latency guarantees. First reply text means arrival at the client stream reader, not a measured browser paint. The final run used one model call, 1,177 input tokens, and 493 output tokens. Submission-to-server receipt was 24ms, context preparation was 0.054ms, and the first provider chunk arrived at 2.170s; usable reply text followed at 4.318s on the server. See [before](artifacts/latency-before.json) and [after](artifacts/latency-after.json) records.

The principal delays were buffering the full structured response and waiting for reasoning before reply text. Ordinary turns already used one model call; context preparation was negligible. Streaming now forwards validated reply text immediately, source caching removes repeated collection uploads, and the default model uses its documented low-reasoning setting. `STEPFUN_REASONING_EFFORT` remains configurable and is sent only for recognized models with documented support. Verification still adds a separate call for deliberate challenges.

The live audio integration was checked with the configured account using one synthetic sentence: TTS returned a valid WAV in **3.355 seconds**, and ASR transcribed that generated audio correctly in **1.571 seconds**. A browser test also passed generated recording → real WAV conversion → live StepFun transcription → editable composer → reply synthesis and native playback, including interruption and replay. A separate browser test used Chrome’s actual WebM/Opus MediaRecorder with a synthetic audio signal and verified conversion to 16 kHz mono PCM16 WAV. These checks do not establish physical microphone capture quality.

## Persistence and limits

One session persists in this browser, including uploaded originals, sources, draft, selected concepts, conversation, evidence, and opaque private state. Resume restores that data. Starting a new collection replaces the saved session. Settings allows deleting the session and cached files.

Collections accept up to five files, 20 MB and 100 pages per file, and 300,000 extracted characters total. Recordings are limited to three minutes and 12 MB. The browser queues speech in sentence-sized chunks of at most 350 characters, prefetching one next chunk while the current one plays. The backend accepts up to 4,096 characters per app request and splits normalized speech at StepFun’s 1,000-character limit. Scanned-PDF OCR and vision interpretation are not implemented. Sparse extraction is reported, and the app never invents topics from a filename. Compare formulas against the rendered original: extraction can lose layout. When exact source geometry is unavailable, the interface uses a page and quote.

Documents and session data persist in IndexedDB. Live preparation sends extracted text to StepFun; live turns send relevant passages and compact context. Requested transcription sends audio, and speech synthesis sends reply text. Raw recordings are discarded after transcription and are not saved on the server. Provider retention settings still apply; local deletion cannot retract requests already processed by StepFun.

Private correction answers and compact memory use an authenticated, encrypted state token. The local key remains at `.miso/state-key` for compatibility with existing saved sessions; keep it private and stable across restarts, or configure `SESSION_SECRET`. The server has no durable lecture or conversation database; its source cache is memory-only. See [server/README.md](server/README.md) for the API contract.

## Build and verify

```sh
npm run check
npm test
npm run build
npm start
```

`npm run check` checks TypeScript without emitting files. `npm test` runs controller, source, provider, streaming, and audio tests. `npm run build` checks types and produces the production frontend in `dist/`. After that build, `npm start` serves the built app and API together at **http://127.0.0.1:3001**.

With the development server running, `npm run test:e2e` runs browser flows in an isolated headless Chrome profile. The configuration uses installed Google Chrome; change `channel` in `playwright.config.ts` if the environment uses another supported browser. Tests cover upload and concept editing, sample sessions, corrections, source grounding, resume, mobile layouts, reduced motion, canceled requests, and voice failure recovery. Screenshots are saved in `artifacts/`. Simulated microphone tests do not establish physical-device capture quality.

With the development server running, these optional checks use the configured StepFun account and may incur API usage:

- `STU_LIVE_SMOKE=1 npm run test:e2e -- tests/provider.spec.ts` enables live PDF and unfamiliar pasted-note checks, including a grounded explanation, source help, and recap. The `--` passes the test-file argument to Playwright. The previous `MISO_LIVE_SMOKE` flag remains supported for existing scripts.
- `STU_LIVE_AUDIO=1 npm run test:e2e -- tests/audio-live.spec.ts` checks real StepFun audio using a generated recording through browser conversion, transcript editing, playback, replay, and cancellation.
- `STU_LIVE_METRICS=1 npx tsx --test tests/latency.live.ts` measures a synthetic text turn and writes `artifacts/latency-after.json`; it also checks reuse of the source cache. `tsx` runs the TypeScript test through Node’s test runner.

These live checks passed with the configured account. They establish the tested flows, not accuracy across every subject or physical-device recording quality. Normal browser tests do not require live credits.
