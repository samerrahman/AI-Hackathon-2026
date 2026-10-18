# Teach Stu

**If you can teach it, you know it.** Paste course notes or upload text-based PDFs, choose one depth, and teach Stu in your own words. Stu is a cheerful, deliberately dim AI student who asks one focused question at a time. Once you have taught the whole topic, Stu teaches it back and quizzes you.

Teach Stu preserves the React study workspace, PDF viewer, source navigation, local session saving, keyboard and reduced-motion behavior, sample demos, and optional voice. It uses model inference and session-specific state. It does **not** train or fine-tune a model, and Stu does not permanently learn from users.

## Run locally

Use Node.js 22.13 or newer:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to the Express server on loopback port 3001. The deterministic **Try a sample session** path works without API keys and always shows a **Sample demo** badge. Its limited fixture responses are for exploring the UI, not judging arbitrary course material.

## Firebase deployment

The public site is [brodidnot.study](https://brodidnot.study), backed by Firebase project `ai-la-hackathon-2026`. The full app needs Firebase Hosting and its `/api` Cloud Function. The project must have billing enabled for Cloud Functions. Set `STEPFUN_API_KEY` and a stable random `SESSION_SECRET` as Firebase Functions secrets, then deploy:

```sh
npm ci
npm ci --prefix functions
npm run build
npx firebase-tools deploy --only functions,hosting --project ai-la-hackathon-2026
```

The API bundle is created by the Functions predeploy step. Keep provider keys out of Vite environment files. See [docs/DOMAIN.md](docs/DOMAIN.md) for the Porkbun DNS records and custom-domain setup.

## Start a live topic

```sh
cp .env.example .env
```

Set `STEPFUN_API_KEY` in the Git-ignored `.env`, restart `npm run dev`, and reload the page. `STEPFUN_BASE_URL` defaults to `https://api.stepfun.ai/v1`. The hidden Judge uses `STEPFUN_JUDGE_MODEL=step-5-preview` by default. The visible Stu uses `STEPFUN_STU_MODEL=step-3.7-flash` by default. For older configurations, `STEPFUN_MODEL` is used as the Judge model only when `STEPFUN_JUDGE_MODEL` is absent. The **Step 5 Preview · Live** badge appears only after a complete, validated dual-model turn whose Judge used `step-5-preview`; key presence alone is labeled unverified.

Give the topic a title, choose **Big picture**, **Exam ready**, or **Expert**, and paste notes or upload text-based PDFs. Pasting notes is the simplest path. Depth is fixed for that topic; start a new topic to change it. The user sees one overall progress bar, never the private rubric. A comprehensive explanation can satisfy several requirements. If later words contradict an earlier explanation, the bar can decrease. Once all requirements are credited and no factual problem remains, the conversation enters **Re-learn** mode: Stu teaches back verified wording, corrects earlier errors against the notes, and asks one quiz question at a time.

During teaching, the hidden Judge receives relevant note text, the private rubric, and the conversation. Stu receives the visible conversation and a sanitized, teacher-grounded director note; Stu does not receive the notes or rubric. During re-learn, the Judge may give Stu a validated, source-grounded teaching brief. See [server/README.md](server/README.md) for the state and evidence rules.

The same StepFun key enables requested transcription and text-to-speech. Microphone input remains explicit: record, stop, review or edit the transcript, then send it. `ENABLE_JUDGE_DEBUG=true` exposes a **Show Judge Evidence** setting for sanitized evidence IDs, verified quotes, problem categories, focus, and model timing. It defaults off and never displays private requirement text or raw model responses.

## Real Step 5 smoke test

A real provider call was not made during this implementation. To test with an authorized key:

1. Put `STEPFUN_API_KEY` in `.env`; leave the default Judge and Stu model IDs. Run `npm run dev` and open `http://127.0.0.1:5173`.
2. Enter a title, paste a few sentences of course notes, choose **Big picture**, and start teaching. The topic should open with a zeroed overall bar. The configured state alone should not show a live badge.
3. Send a substantive typed explanation in your own words. Confirm Stu asks one short question, the overall progress updates only for supported teaching, and **Step 5 Preview · Live** appears after that complete turn. Open Settings to confirm it reports a completed live turn.
4. Send a vague answer such as “yes, exactly” and confirm it does not earn new credit. If a provider error occurs, confirm the draft remains available for retry.

Use original pasted notes for this test; the bundled samples are deterministic. A live account with model access and sufficient balance is required. The integration follows official [StepFun chat completions](https://platform.stepfun.ai/docs/en/api-reference/chat/chat-completion-create), [structured output](https://platform.stepfun.ai/docs/en/guides/developer/json-mode), and [error handling](https://platform.stepfun.ai/docs/en/guides/developer/exception) documentation.

## Data and limits

Original PDFs, extracted text, drafts, conversation, progress counts, and an opaque encrypted state token are saved in this browser's IndexedDB. The private rubric and evidence state exist only inside authenticated AES-GCM server state, bound to the topic and actual document text. The browser cannot read rubric requirements from the token. Relevant extracted text and conversation are sent to StepFun for live Judge calls. Stu receives conversation and a safe director note in teaching mode. Requested voice sends audio or response text to StepFun. Raw recordings are not persisted by Teach Stu. Provider account retention settings still apply; deleting local data cannot retract requests already processed by providers.

Collections allow five files, 20 MB and 100 pages per file, and 300,000 extracted characters total. Recordings are limited to three minutes and 12 MB. Scanned-PDF OCR is unavailable. PDF extraction can lose mathematical layout, so inspect formulas against the original page. The server stores no document or conversation database. Its local encryption key remains in `.miso/state-key` for compatibility with existing saved sessions; keep it stable across restarts or set `SESSION_SECRET`.

## Verify

```sh
npm run check
npm test
npm run build
npm run test:e2e
```

`npm test` uses mocked providers and consumes no API credits. The browser tests also use samples or mocked responses. Build output is served with `npm start` at **http://127.0.0.1:3001**. Live model behavior and real microphone playback require a separate authorized smoke test.
