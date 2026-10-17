# AGENTS.md — shared context for every human and AI agent

This is the single source of truth for how agents (Claude Code, Cursor, Codex,
Gemini, Copilot, etc.) work in this repo. Tool-specific files (`CLAUDE.md`,
`GEMINI.md`, ...) only point here. **Edit this file, not those.**

## Project
**Teach Stu**: a learn-by-teaching app. The user picks a depth (Big picture /
Exam-ready / Expert), pastes course notes, and Claude builds a hidden rubric at that
depth. The user teaches "Stu", a deliberately dim AI learner, in three stages: **cover**
every idea, **explain** each one, then **connect** them. Once everything is taught, the
same chat switches to **re-learn mode**, where Stu explains the topic back and quizzes the user.

Each teaching turn makes two LLM calls:
1. **Judge** (hidden, pessimistic): grades the teacher's words against the rubric and the
   notes. It returns credited items, each with a verbatim evidence quote, plus revoked
   items, problems, and a note telling Stu what to be confused about. The server drops any
   credit whose quote doesn't appear in the teacher's messages.
2. **Stu** (visible): replies in character from the transcript plus that director note.
   Stu never sees the notes, so he can't leak answers.

The user only sees one overall progress bar; per-stage and per-item progress stays hidden
(visible only through the "Show the hidden judge" debug toggle).

The AI provider is set with `LLM_PROVIDER` in `.env`: `gemini` (free key, `gemini-3.8-flash`),
`asi1` (Fetch.ai ASI:One, `asi1`), or `anthropic` (`claude-opus-5-5`). Gemini and ASI:One are
called with plain `fetch`; their JSON output is validated with zod and retried once.

Stack: `client/` is Vite + React (state in localStorage); `server/` is Express.
- `server/prompts.js`: depth levels, rubric, judge, Stu and review prompts (the core of the product)
- `server/llm.js`: provider layer (`structured()` / `text()`) for anthropic, gemini and asi1
- `server/rubric.js`: item ids and stage logic, shared with the client
- `server/index.js`: `/api/depths`, `/api/topics/prepare`, `/api/chat` (mode `teach` | `review`)
- `server/mock.js`: canned responses when `MOCK=1`
- `client/src/App.jsx`: the whole UI ("Show the hidden judge" toggle in the sidebar for debugging)

## Before you start any work
1. `git pull --rebase origin main`
2. Read this file and `docs/DECISIONS.md`.
3. Find or open a **GitHub Issue** for your task and assign it to yourself
   (or comment "claimed by <name>/<agent>"). Issues are the task board —
   don't start work nobody has claimed, and don't take a claimed one.

## How to work
- Branch per task: `<name>/<issue#>-short-slug` (e.g. `samer/12-auth-flow`).
  Never commit directly to `main`.
- Keep PRs small and focused; open a **draft PR early** so others see what's in flight.
- Reference the issue in the PR (`Closes #12`).
- Rebase on `main` before marking a PR ready. Resolve your own conflicts.
- Don't reformat or refactor files outside your task — it causes conflicts for others.
- Never commit secrets. Use `.env` (gitignored) and document keys in `.env.example`.

## Ownership (update as the team splits work)
| Area | Owner |
|------|-------|
| _e.g. frontend/_ | _name_ |
| _e.g. backend/_ | _name_ |

Touching someone else's area? Comment on their issue/PR first.

## Recording decisions
Any architectural choice (framework, API shape, data model, env var) goes in
`docs/DECISIONS.md` as a dated one-liner in the same PR. That's how other
agents learn about it.

## Commands
```bash
cp .env.example .env   # set LLM_PROVIDER + its key, or MOCK=1 to work without one
npm install
npm run dev            # client on :5173, API on :3001 (API_PORT)
```
