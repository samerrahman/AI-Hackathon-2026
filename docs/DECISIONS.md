# Decisions log

Append-only. Newest at the bottom. Format: `YYYY-MM-DD — decision — why (who)`

- 2026-10-17 — AGENTS.md is the canonical agent context; GitHub Issues are the task board — keep many agents in sync (samer)
- 2026-10-17 — The four project owners share code review; each agent uses a separate worktree or clone and main requires a PR with owner review — avoid collisions and unreviewed merges (samer)
- 2026-10-17 — Use Next.js App Router with strict TypeScript, Tailwind, Zod, and Vitest — deliver a responsive, testable web MVP quickly (ruxinsheng/Codex)
- 2026-10-17 — Use StepFun's `step-5-preview` through the official OpenAI client and a server-side OpenAI-compatible endpoint — satisfy the StepFun challenge while keeping credentials private (ruxinsheng/Codex)
- 2026-10-17 — Separate a hidden rubric evaluator from the warm, naïve student-facing pupil — probe one gap per turn without exposing evaluator reasoning (ruxinsheng/Codex)
- 2026-10-17 — Persist the teaching session only in browser localStorage — resume locally without authentication or a database (ruxinsheng/Codex)
- 2026-10-17 — Provide a deterministic demo evaluator and report fallback — keep the complete presentation flow available without API credentials (ruxinsheng/Codex)
- 2026-10-17 — Send concept labels to the browser while retaining rubric criteria server-side; seal generated custom rubrics in an opaque session token — preserve local-only sessions without exposing evaluator criteria (ruxinsheng/Codex)
- 2026-10-17 — Teach Stu runs on Vite + React with an Express API; the earlier Next.js DumbAI MVP files were removed — they were unused and broke `npm run check` and the Vite build (samer/Claude)
- 2026-10-17 — Header shows only the overall bar and %, never item counts; Stu gets one silent retry when he breaks his output rules — match "one overall progress bar" and avoid needless retry errors (samer/Claude)
- 2026-10-17 — Adopt Lea's `lea2` visual design (SVG Stu, chat thread, session tabs, expression playground) on top of Lucy's judge/Stu engine; skip Lea's visible concept-picking screen — keep the rubric hidden and show only one overall bar (samer/Claude)
- 2026-10-17 — Stu's face reacts only to the overall progress change (pleased when it rises, puzzled otherwise) — character feedback without revealing which item was credited (samer/Claude)
- 2026-10-17 — Deploy Lucy's Teach Stu frontend to the existing `ai-la-hackathon-2026` Firebase Hosting site at `brodidnot.study`; the Hosting-only build offers local note browsing and labels server-dependent study, sample conversations, and voice as forthcoming (samer/Codex)
- 2026-10-17 — Use `brodidnot.study` as the canonical public address by redirecting Firebase's generated browser hostnames there; remove the global preview banner while retaining honest labels for unavailable server features (samer/Codex)
- 2026-10-17 — Route `/api/**` from Firebase Hosting to a second-generation Cloud Function with two secret-bound variables (`STEPFUN_API_KEY`, stable `SESSION_SECRET`) and a two-instance ceiling — enable the full site while keeping paid credentials and sealed session state server-side (samer/Codex)
- 2026-10-17 — Use StepFun transcription (`stepaudio-2.5-asr`) and speech (`stepaudio-3-tts`) for optional voice; convert browser recordings to 16 kHz mono WAV in memory — use the same server-side provider key and a documented audio format (samer/Codex)
- 2026-10-17 — Move the full Vite site and Express `/api` to Vercel Hobby with a stable server-side `SESSION_SECRET` and `STEPFUN_API_KEY` environment variable — run the app without upgrading the Firebase project to a paid plan (samer/Codex)
- 2026-10-17 — Use James's StepFun voice adapter (`/audio/asr/sse` with `stepaudio-3-asr-max`, chunked WAV `stepaudio-3-tts` with the `vibrant-youth` voice and Stu persona, browser-side 16 kHz WAV encoding) instead of the multipart transcription call — it matches StepFun's actual ASR API (samer/Claude)
