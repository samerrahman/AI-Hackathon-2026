# Miso API boundary

`index.ts` serves the API on loopback port 3001 and serves `dist/` after a production build. The Vite development server proxies `/api` to it. Set `.env` from `.env.example`; never prefix private keys with `VITE_`.

Live study uses Gemini `generateContent` with server-side Zod validation of its JSON schema, source IDs, and exact challenge quotes. The model is configurable. No live call is replaced with a demo response on error. Missing credentials produce a setup message. The optional OpenAI transcription and speech endpoints use multipart audio and MP3 output respectively. Voice recordings stay in memory only while being transcribed.

Provider contracts were checked against [Gemini generation configuration](https://ai.google.dev/api/generate-content), [OpenAI transcription](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create), and [OpenAI speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create). Credential presence does not establish model access; the UI reports request errors without exposing provider bodies or credentials.

The browser keeps documents, history, source references, and evidence in IndexedDB. Relevant extracted passages and recent conversation are sent to Gemini for live turns; source text is sent for outline extraction. Audio is sent to OpenAI only for requested voice operations. These calls are subject to the providers' account retention settings; deleting local data cannot retract already processed provider requests. Miso does not upload PDFs to a remote provider file store or persist recordings on the server.

Private pending challenge answers are kept in an authenticated AES-GCM state token, bound to the session and the actual document text. The browser persists that opaque token. `.miso/state-key` is generated with restricted permissions and must remain private and stable across restarts. `SESSION_SECRET` can supply a stable deployment secret. The server has no session database; deleting a browser session removes its originals and derived data there, while the deletion endpoint clears the transient server revision guard.

The cadence controller permits at most one deliberate challenge in three substantial typed/transcribed exchanges (six in Gentle mode). Independent verification must approve a candidate before display. A pending challenge is resolved deterministically before skip, finish, concept change, or disabling challenges, even without an available provider. An accepted false paraphrase gets a hint and then its accurate correction, never positive evidence. This is educational model review, not formal verification.

The synthetic sample adapter is deliberately separate and conservative. It recognizes a limited set of clear sample explanations; unfamiliar wording is marked unassessed rather than declared wrong. It never evaluates arbitrary uploaded notes. A live provider is required for general document-derived assessment.

Configured collection limits: five files; 20 MB per file; 100 pages per file; 300,000 total extracted characters. Audio limit: 12 MB per recording. No OCR or vision extraction is implemented; unreliable extraction is surfaced by the client, and text-source precision is limited to its real geometry.
