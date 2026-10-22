# AGENTS.md — shared context for every human and AI agent

This is the single source of truth for how agents (Claude Code, Cursor, Codex,
Gemini, Copilot, etc.) work in this repo. Tool-specific files (`CLAUDE.md`,
`GEMINI.md`, ...) only point here. **Edit this file, not those.**

## Project
**Teach Stu**: students learn by teaching a deliberately dim AI student. The user picks a
fixed depth (Big picture / Exam ready / Expert) and pastes notes or uploads PDFs. A hidden,
pessimistic **Judge** (StepFun `step-5-preview`) grades every teacher message against a private
cover → explain → connect rubric, with server-verified verbatim quotes. The visible **Stu**
(`step-3.7-flash`) only sees the chat and a sanitized director note. The user sees one overall
progress bar; once everything is taught, the chat flips to re-learn mode.

The UI design (palette, SVG Stu with expressions, chat workspace, landing page) comes from Lea's
`lea2` branch; the teaching engine and flow are Lucy's. Notes live in a **Notes** tab beside the chat.

Stack: Vite + React (`web/`), Express API (`server/`, deployed through `api/`), shared types (`shared/`), strict
TypeScript, Zod, `node:test`, Playwright. Without `STEPFUN_API_KEY`, use **Try a sample session**.
See `README.md` and `server/README.md` for the state and evidence rules.

## Before you start any work
1. Work in your own clone or worktree. Fetch the latest `main` before creating
   your task branch; do not switch branches in another agent's checkout.
2. Read this file and `docs/DECISIONS.md`.
3. Find or open a **GitHub Issue** for your task and assign it to yourself
   (or comment "claimed by <name>/<agent>"). Issues are the task board —
   don't start work nobody has claimed, and don't take a claimed one.

## How to work
- Branch per task: `<name>/<issue#>-short-slug` (e.g. `samer/12-auth-flow`).
  Never commit directly to `main`.
- One working directory per task/agent. Use `git worktree add` from the latest
  `origin/main` when sharing a machine. Never reset, clean, or overwrite another
  person's uncommitted work.
- Keep PRs small and focused; open a **draft PR early** so others see what's in flight.
- Reference the issue in the PR (`Closes #12`).
- Rebase on `main` before marking a PR ready. Resolve your own conflicts.
- Don't reformat or refactor files outside your task — it causes conflicts for others.
- Never commit secrets. Use `.env` (gitignored) and document keys in `.env.example`.

## Ownership
The four shared code owners are @ruxinsheng, @jamlol123, @zenoro0, and
@samerrahman. `.github/CODEOWNERS` requests their review for repository changes;
one owner other than the PR author must approve before merging to `main`.

As areas acquire primary owners, record them here and update CODEOWNERS in the
same PR. Keep GitHub Issues as the source of truth for current task ownership.

Touching someone else's area? Comment on their issue/PR first.

## Recording decisions
Any architectural choice (framework, API shape, data model, env var) goes in
`docs/DECISIONS.md` as a dated one-liner in the same PR. That's how other
agents learn about it.

## Commands
`npm ci` · `npm run dev` (web on 127.0.0.1:5173, API on :3001) · `npm run check` · `npm test` · `npm run build` · `npm run test:e2e` (Playwright; config in `tests/`)
