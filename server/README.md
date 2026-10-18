# Stu API boundary

`index.ts` serves the API on loopback port 3001 and serves `dist/` after a production build. Vite proxies `/api` during development. Configure `.env` using `.env.example`; private keys must never use a `VITE_` prefix. StepFun is the active live provider for study and audio, with no alternate-service fallback.

## Text turns and sources

`POST /api/concepts` validates the extracted document collection, obtains an editable outline, and returns a session-scoped collection ID. `CollectionCache` retains at most 30 collections in process memory, with a sliding one-hour expiry. It stores extracted sources, not uploaded PDF binaries. A server restart or expiry returns `COLLECTION_EXPIRED`; the browser reconnects its saved document data before retrying. Deleting a session clears the corresponding cache and revision guard.

`POST /api/turn` accepts `Accept: text/event-stream` and emits `ready`, `text`, `complete`, or `error` events. Each event includes session, turn, revision, and concept identifiers. The browser rejects stale identifiers; disconnecting aborts provider work. Response headers disable proxy buffering and transformation. Deployments must also preserve streaming through their own reverse proxy.

`stepfun-provider.ts` calls `POST {STEPFUN_BASE_URL}/chat/completions` directly, using `STEPFUN_API_KEY` and configurable `STEPFUN_MODEL` (default `step-3.7-flash`). See StepFun’s [Chat API](https://platform.stepfun.ai/docs/en/api-reference/chat/chat-completion-create), [structured outputs](https://platform.stepfun.ai/docs/en/guides/developer/json-mode), and [streaming guide](https://platform.stepfun.ai/docs/en/guides/developer/stream). `STEPFUN_REASONING_EFFORT` defaults to `low`; it is sent only for recognized models with documented reasoning controls, including the default model.

Ordinary conversational turns use one primary request with retrieved passages, eight recent messages, and compact memory. Reply text is extracted from the streamed structured output only after its source and action header is validated. Provider reasoning fields, raw JSON, and private assessment fields never reach chat. Full Zod and source validation still runs before committing evidence and state. A malformed or interrupted stream leaves the draft recoverable.

Challenge candidates are withheld until a separate verifier approves their accurate correction and exact source support. This intentionally adds a call to those turns. Uncertain candidates become clarification rather than an unverified intentional mistake. The controller prevents simultaneous unresolved challenges and guarantees resolution before skip, finish, concept change, or disabling challenges—even if the provider becomes unavailable. An accepted false paraphrase never becomes positive evidence. Model verification is not formal proof.

Numeric diagnostics include request receipt delay, retrieval/preparation time, first provider chunk, first visible text, completion time, per-call timings, and reported token counts. First chunks may contain reasoning and are measured separately from visible reply text. The client emits `stu:turn-timing` for diagnostics. Do not log prompts, raw responses, keys, lecture content, or recordings. The [measured comparison](../README.md#streaming-memory-and-latency) records first reply arrival at 15.437s before and 4.346s after streaming plus the model/reasoning change; these are individual synthetic runs, not guaranteed performance.

## StepFun audio

Both audio routes use the existing same-origin API boundary, bounded requests, cancellation on disconnect, and the server key. The complete typed path remains available on permission, transcription, synthesis, or playback failures.

| Variable | Default / purpose |
| --- | --- |
| `VOICE_PROVIDER` | `stepfun`; set `off` to disable audio |
| `STEPFUN_API_KEY` | Shared server credential for text and audio |
| `STEPFUN_BASE_URL` | `https://api.stepfun.ai/v1` |
| `STEPFUN_AUDIO_BASE_URL` | Optional audio override; otherwise the shared base URL |
| `STEPFUN_TRANSCRIBE_MODEL` | `stepaudio-3-asr-max` |
| `STEPFUN_TTS_MODEL` | `stepaudio-3-tts` |
| `STEPFUN_TTS_VOICE` | `vibrant-youth` |
| `STEPFUN_AUDIO_LANGUAGE` | `en` |

Use the endpoint matching the account; Step Plan documents `https://api.stepfun.ai/step_plan/v1` for audio. Presence of a key is not proof of audio model access.

`POST /api/transcribe` receives a recording as multipart data from the browser. The adapter validates actual audio-container bytes and converts the request to StepFun’s [ASR JSON/SSE format](https://platform.stepfun.ai/docs/en/api-reference/audio/asr-sse): `POST {base}/audio/asr/sse` with Base64 audio, nested `audio.input.transcription`, and `audio.input.format`. This is not an OpenAI multipart transcription request. Supported validated containers are WAV, OGG, MP3, and M4A. WebM is rejected, never renamed as WAV. The browser produces PCM WAV. Only `transcript.text.done` becomes an editable transcript; incomplete deltas are never submitted as an answer. The transcription deadline is 60 seconds.

`POST /api/speech` accepts displayed reply text, normalizes spoken notation, and calls StepFun’s [speech API](https://platform.stepfun.ai/docs/en/api-reference/audio/create-audio) at `POST {base}/audio/speech`. Global delivery uses the separate `instruction` field. Parenthetical content is converted to explicit spoken grouping because StepFun otherwise treats it as an unspoken direction. Normalization covers common mathematical notation without changing the displayed reply; it is not a universal math-to-speech system.

TTS requests use WAV at 24 kHz and at most 1,000 characters per provider request. Multiple outputs are assembled from validated PCM samples, not concatenated WAV headers. The app caps input at 4,096 characters and synthesis at 120 seconds. The browser queues at most 350 characters per sentence-sized chunk and prefetches one next chunk while playing the current one; cancellation clears both playback and queued requests. Text streaming does not wait for audio. Do not add `stream_format: "audio"` to these WAV requests: the configured live service rejects that combination. The native Realtime API is not used.

Live access was verified using one synthetic sentence: `stepaudio-3-tts` with `vibrant-youth` returned valid WAV in **3.355s**, and `stepaudio-3-asr-max` transcribed that WAV correctly in **1.571s**. These measurements are individual calls and do not establish real microphone quality or sustained performance. Seven focused audio tests cover wire contracts, actual formats, final SSE handling, math grouping, cancellation, safe errors, and WAV assembly.

## Saved state and privacy

The browser stores documents, references, conversation, draft, and evidence in IndexedDB. Server-private memory and pending correction answers are bound to the session and actual source text in an authenticated AES-GCM token. Memory retains at most eight whole explanation/correction records within 8,000 serialized characters. It distinguishes independently explained content, supported work, source-resolved corrections, and unresolved misconceptions; a resolved source claim does not automatically establish that the user understood it.

The existing `.miso/state-key` path remains stable to preserve saved sessions. Keep this generated key private, or use `SESSION_SECRET` for a stable deployment secret. There is no durable server session database. Local deletion removes originals and derived browser data; it cannot retract content already sent to StepFun. Raw recordings are not persisted. Provider account retention settings apply.

Configured collection limits: five files, 20 MB per file, 100 pages per file, and 300,000 total extracted characters. Recording limits: three minutes and 12 MB. No OCR or vision extraction is implemented. Source annotations use validated IDs and real extraction geometry; unreliable geometry falls back to a page and quote.

Sample mode remains visibly separate and conservative. It evaluates only the bundled synthetic fixtures and marks unfamiliar wording unassessed. It never evaluates arbitrary uploaded notes or silently replaces failed live responses.
