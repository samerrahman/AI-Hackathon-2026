# Teach Stu

**If you can teach it, you know it.** Paste course notes or upload text-based PDFs, choose one depth, and teach Stu in your own words. Stu is a cheerful, deliberately dim AI student who asks one focused question at a time. Once you have taught the whole topic, Stu teaches it back and quizzes you.

Teach Stu preserves the React study workspace, PDF viewer, source navigation, local session saving, keyboard and reduced-motion behavior, sample demos, and optional voice. It uses model inference and session-specific state. It does **not** train or fine-tune a model, and Stu does not permanently learn from users.

## How Teach Stu uses Step 5 Preview

Every live topic calls StepFun's **`step-5-preview`**: once to build the private rubric from your notes, then on every message you send, before Stu is allowed to reply. If that call fails, Stu does not answer and your draft stays in the box for a retry.

| Step | Model | What it does | What it sees |
| --- | --- | --- | --- |
| Rubric | `step-5-preview` | Turns your notes into hidden *cover → explain → connect* requirements at the depth you chose | Your notes, title, depth |
| Judge (every turn) | `step-5-preview` | Pessimistically grades your latest message; every credit must quote your exact words, which the server re-checks | Relevant notes, rubric, conversation |
| Stu (every turn) | `step-3.7-flash` | The visible, deliberately dim student: one short question, sometimes a planted mix-up for you to catch | Conversation and a sanitized note from the Judge, never the notes or rubric |
| Re-learn | `step-5-preview` → `step-3.7-flash` | After you finish, the Judge writes a source-grounded recap and quiz; Stu delivers it | Verified teacher quotes, notes |
| Voice (optional) | `stepaudio-3-asr-max`, `stepaudio-3-tts` | Transcribes your spoken explanation for you to review before sending; reads Stu's replies aloud | Your recording; Stu's reply text |

The Judge runs on Step 5 Preview because grading is the part that has to be right. Stu runs on a faster model so replies come back quickly, and he can't leak answers he was never given. You stay in control: you pick the depth, review every transcript before it's sent, can pause, end, or delete a session, and the **Step 5 Preview · Live** badge only appears after a turn whose Judge actually used `step-5-preview`. Sample sessions are labeled **Sample demo** and use fixed responses instead of a model.

## Run locally

Use Node.js 22.13 or newer:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to the Express server on loopback port 3001. The deterministic **Try a sample session** path works without API keys and always shows a **Sample demo** badge. Its limited fixture responses are for exploring the UI, not judging arbitrary course material.

## Public deployment

The public address is [brodidnot.study](https://brodidnot.study). Firebase Hosting currently serves a static preview for free. The full site uses Vercel's Vite hosting and a same-origin Express function; the Vercel project needs server-side `STEPFUN_API_KEY` and a stable random `SESSION_SECRET` in its Production and Preview environment variables. Keep both out of Git and Vite variables. Deploy and verify the Vercel preview before moving the domain's DNS from Firebase to Vercel.

```sh
npm ci
npm run build
vercel deploy
```

`vercel.json` sends `/api` requests to the Express function and serves Vite's `dist` files for the rest. Vercel Fluid Compute is enabled with a 180-second maximum request duration. See [docs/DOMAIN.md](docs/DOMAIN.md) for the current Porkbun records; update them to Vercel's project-specific values only after the preview works.

## Start a live topic

```sh
cp .env.example .env
```

Set `STEPFUN_API_KEY` in the Git-ignored `.env`, restart `npm run dev`, and reload the page. `STEPFUN_BASE_URL` defaults to `https://api.stepfun.ai/v1`. The hidden Judge uses `STEPFUN_JUDGE_MODEL=step-5-preview` by default. The visible Stu uses `STEPFUN_STU_MODEL=step-3.7-flash` by default. For older configurations, `STEPFUN_MODEL` is used as the Judge model only when `STEPFUN_JUDGE_MODEL` is absent. The **Step 5 Preview · Live** badge appears only after a complete, validated dual-model turn whose Judge used `step-5-preview`; key presence alone is labeled unverified.

Give the topic a title, choose **Big picture**, **Exam ready**, or **Expert**, and paste notes or upload text-based PDFs. Pasting notes is the simplest path. You can also choose **or just start talking** with no notes at all: Step 5 Preview then builds the rubric from the title and depth and judges from its own mainstream knowledge. Notes are still better for course-specific details, because the Judge can check your claims against them and re-learn can cite pages. Depth is fixed for that topic; start a new topic to change it. The user sees one overall progress bar, never the private rubric. A comprehensive explanation can satisfy several requirements. If later words contradict an earlier explanation, the bar can decrease. Once all requirements are credited and no factual problem remains, the conversation enters **Re-learn** mode: Stu teaches back verified wording, corrects earlier errors against the notes, and asks one quiz question at a time.

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
