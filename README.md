# Teach a Stupid AI

A playful K–12 learning-by-teaching MVP. Students teach a deliberately confused AI character, respond to follow-up questions, correct a planned misunderstanding, and receive an evidence-grounded formative report card.

Students can optionally upload lesson notes or slides before starting. TXT, Markdown, RTF, PPT, and PPTX files up to 8 MB are accepted; modern PowerPoint text is extracted to suggest a subject and topic and to give the AI student lesson context. Legacy `.ppt` files use the filename as context because that binary format cannot be safely unpacked in the browser-facing service.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the local URL printed in the terminal. An API key is optional: without one, the complete experience automatically uses the scripted demo student and demo assessment.

## Live AI mode

Set these server-only variables in `.env.local`:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5-mini
```

`OPENAI_MODEL` is configurable. The key is only read by the protected server route. Chat and assessment responses use separate OpenAI Responses API calls with validated structured output.

## Checks

```bash
npm run lint
npm test
npm run build
```

Session progress and up to five recent lesson summaries are stored only in the browser's local storage. There is no account or database, and students are reminded not to share personal information.

Uploaded material is processed in memory for the current lesson and is treated as untrusted reference text, not as AI instructions.
