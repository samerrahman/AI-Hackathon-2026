# Decisions log

Append-only. Newest at the bottom. Format: `YYYY-MM-DD — decision — why (who)`

- 2026-10-17 — AGENTS.md is the canonical agent context; GitHub Issues are the task board — keep many agents in sync (samer)
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
