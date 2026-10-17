# AGENTS.md — shared context for every human and AI agent

This is the single source of truth for how agents (Claude Code, Cursor, Codex,
Gemini, Copilot, etc.) work in this repo. Tool-specific files (`CLAUDE.md`,
`GEMINI.md`, ...) only point here. **Edit this file, not those.**

## Project
AI LA Hackathon 2026 project. _TODO: one-paragraph description, stack, how to run._

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
_TODO: install / dev / test / lint commands once the stack exists._
