# DumbAI

**If you can teach it, you understand it.**

DumbAI is a learning experience for the AI LA Hackathon 2026. A student teaches a warm, intentionally naïve AI pupil. Its follow-up questions make vague definitions, missing causes, weak examples, and hidden assumptions visible. A private evaluator tracks concept coverage and turns the lesson into reflective feedback.

## Quick start

Requires Node.js 20.9+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The example environment enables demo mode, so no API key is needed. To use StepFun, set `STEPFUN_API_KEY` in `.env.local` and set `DEMO_MODE=false`. Never put credentials in client code or commit `.env.local`.

| Server variable | Purpose |
| --- | --- |
| `STEPFUN_API_KEY` | StepFun credential; absent means demo mode. |
| `STEPFUN_BASE_URL` | OpenAI-compatible base URL; defaults to `https://api.stepfun.ai/v1`. |
| `STEPFUN_MODEL` | Model ID; defaults to `step-5-preview`. |
| `DEMO_MODE` | `true` forces deterministic demo mode even with a key. |

## Demo journey

1. Keep **Gradient descent** selected and press **Start teaching**.
2. Explain the goal: “We want to reduce the error in a model's predictions.”
3. Explain the slope: “The gradient tells us the steepest uphill direction, so we go downhill.”
4. Add an example and the learning rate: “Imagine walking down a hill. Small steps avoid jumping over the bottom; we repeat until the error is low.”
5. Watch the understanding map illuminate, try **That question is too easy**, **Make it simpler**, or **Give me a small hint**, then finish for the report.

The three curated topics are gradient descent, photosynthesis, and recursion. A custom topic accepts optional reference notes; without notes, Step 5 Preview generates a provisional rubric labeled **AI-generated rubric**. In demo mode, a generic provisional rubric keeps custom topics usable.

## How Step 5 Preview contributes

The running server calls `step-5-preview` through the official `openai` npm client at StepFun's OpenAI-compatible endpoint. `src/lib/evaluator.ts` sends the hidden concept rubric, chosen difficulty, previous conversation, latest explanation, and control signal to the model. The model assesses cumulative coverage and returns one strategically naïve next question. The API exposes only student-facing feedback and coverage; it removes the private `questionPurpose`. The model also creates a provisional rubric for custom topics without reference notes. Each normal teaching turn makes one model call; malformed output triggers one repair call. A failed API call falls back to the deterministic evaluator.

The interface explains this workflow with a visible understanding map, one question at a time, an explicit **Demo mode** badge, and a final learning report. Scores are labeled AI-generated learning feedback, not academic grades. Session data stays in browser localStorage. The browser receives concept labels, while curated criteria remain on the server; generated custom criteria travel in an opaque encrypted session token. No secret or model configuration is stored in client state.

## Architecture

- `src/app/api/start/route.ts`: selects a curated rubric, derives one from pasted notes, or generates a provisional rubric.
- `src/app/api/evaluate/route.ts`: validates requests, evaluates the lesson server-side, and strips private evaluator reasoning.
- `src/lib/models.ts`: strict Zod schemas and typed data models.
- `src/lib/topics.ts`: curated concept rubrics.
- `src/lib/rubric-privacy.ts`: public concept projection and sealed custom rubrics.
- `src/lib/evaluator.ts`: StepFun client, JSON extraction, validation, one repair retry, fallback.
- `src/lib/demo.ts`: deterministic scripted evaluator, including gradient-descent follow-ups.
- `src/lib/session.ts`: deterministic session progression, coverage, six-turn limit, and learning report.
- `src/components/DumbAIApp.tsx`: topic setup, teaching, report, and localStorage persistence.

## Checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

This MVP targets Applied Intelligence in education and StepFun's **Get It Done with Step 5 Preview** challenge, with a strong visual design for the Paper Best Designed Hack. It deliberately excludes accounts, databases, voice, uploads, and analytics.
