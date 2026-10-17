# AGENTS.md — shared context for every human and AI agent

This is the single source of truth for how agents (Claude Code, Cursor, Codex,
Gemini, Copilot, etc.) work in this repo. Tool-specific files (`CLAUDE.md`,
`GEMINI.md`, ...) only point here. **Edit this file, not those.**

## Project
**Teach Pip**: a learn-by-teaching app. The user pastes course notes for a topic,
and Claude extracts a checklist of concepts. The user then has to teach each one to
"Pip", a deliberately dim AI learner that takes things literally, makes mistakes, and asks
clarifying questions. Pip marks a concept learned only after a specific, correct
explanation. Once every concept is taught, the same chat switches to **re-learn mode**,
where Pip explains the topic back and quizzes the user.

Stack: `client/` is Vite + React (state in localStorage); `server/` is Express +
`@anthropic-ai/sdk` (model `claude-opus-5-5`, structured outputs).
- `server/prompts.js`: Pip's persona and grading prompts (the core of the product)
- `server/index.js`: `/api/topics/prepare` and `/api/chat` (mode `teach` | `review`)
- `server/mock.js`: canned responses when `MOCK=1`
- `client/src/App.jsx`: the whole UI

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
cp .env.example .env   # add ANTHROPIC_API_KEY, or set MOCK=1 to work without one
npm install
npm run dev            # client on :5173, API on :3001 (API_PORT)
```
