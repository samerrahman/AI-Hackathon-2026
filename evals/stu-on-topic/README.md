# Stu on-topic eval (live)

Does Stu stay on the topic of the original notes? A user reported that he doesn't. In a no-notes
*Photosynthesis* topic, Stu asked "what do they use for energy at nighttime?", then whether cellular
respiration is "the same as when our bodies breathe". The chat drifted into respiration, never covered the
photosynthesis syllabus, and the progress bar never moved.

This eval replays that situation against the real engine and real StepFun models, so a fix can be measured
before and after.

## What it runs

- **4 topics** (`fixtures/`), each a `POST /api/topic` body at depth *big picture*:
  - `experiments`: the sample PDF *Experiments and causal claims*, captured from the browser upload flow.
  - `sequences`: the sample PDF *Sequences and convergence*, captured the same way.
  - `photosynthesis`: pasted notes (`fixtures/photosynthesis.txt`) turned into a document exactly as
    `ingestText` in `src/lib/documents.ts` does it.
  - `supply-and-demand`: no notes ("or just start talking"), so the Judge grades from its own knowledge.
- **3 teacher personas**, played by `step-3.7-flash` (`teacher.mts`). Each sees the notes (or, without
  notes, only the title) and the visible chat, never the rubric. Every persona opens with a short
  explanation of the first idea.
  - `follower` answers exactly whatever Stu asks, even beyond the notes, from everyday knowledge, and is
    sometimes a little wrong. This reproduces the complaint: wherever Stu goes, the chat goes.
  - `drifter` teaches the notes, but every other message wanders into a tangent or anecdote.
  - `diligent` teaches the notes one idea at a time and answers Stu only when he asks about the notes.
- **12 scenarios** (topic × persona), 6 teacher turns each by default, at most 3 at a time.

Each turn goes through the app's own code path. The simulated teacher writes a message, then
`runTeachTurn` produces Stu's reply, then `runJudgeTurn` grades it. If grading finishes the topic, a second
`runJudgeTurn` produces Stu's teach-back. State tokens, revisions and message ids are threaded the way
`teach()` and `runJudge()` in `src/App.tsx` do it. The eval doesn't change any app code. It wraps the
provider only to record what each model call received and returned.

## Run it

```sh
npx tsx evals/stu-on-topic/run.mts --label baseline          # about 15 minutes for all 12 scenarios
npx tsx evals/stu-on-topic/grade.mts --label baseline        # a few minutes: labels every Stu reply
```

| `run.mts` flag | Meaning |
| --- | --- |
| `--label <name>` | Required. Output goes to `results/<name>/`. |
| `--turns N` | Teacher turns per scenario (default 6). |
| `--only a,b` | Scenario ids (`photosynthesis-follower`), topics (`photosynthesis`) or personas (`drifter`). |
| `--concurrency N` | Scenarios at a time (default 3; StepFun rate-limits). |
| `--fresh-topics` | Rebuild the rubrics instead of reusing `results/cache/`. |

The eval needs `STEPFUN_API_KEY` in `.env` and calls StepFun for real, so every run costs money. The key is
only sent as the request header and is never printed or logged. Rate limits (`PROVIDER_LIMIT`) are retried
with backoff. Any other failure is recorded on its turn, and the scenario continues. After a failed Stu
reply the teacher's words are dropped, as they are when the app puts them back in the box. After a failed
grading the message stays queued and is graded with the next one, as in the app.

Each fixture's rubric (the `createTeachTopic` output) is cached in `results/cache/<fixture>.json` and
reused, so before-and-after runs grade against the same plan. The runner sets a fixed `SESSION_SECRET` so
those cached tokens stay readable. If you change a fixture, its cache rebuilds automatically.
`make-fixtures.mts` regenerates the photosynthesis and no-notes fixtures.

## Output (`results/`, gitignored)

- `results/<label>/<scenario>.json` holds the topic, persona, `notesText`, `syllabus` (the rubric's core
  ideas) and the full rubric. For every turn it records:
  - the teacher's message
  - Stu's reply and latency, the director focus Stu was given, and each parallel Stu sample
  - the Judge's latency, credits (mapped to rubric items), problem types, the raw problems, and the focus
    it set for Stu's next reply
  - progress, mode, and any errors

  The file also keeps the log of every model call.
- `results/<label>/summary.json` has latency stats (median, p90, mean, min, max) for Stu, the Judge and
  the teacher, plus per-scenario turns, errors, final progress and problem types.
- `results/<label>/provider.log` holds the provider's content-free call metadata (durations, token counts).
- `results/<label>/grades.json` comes from `grade.mts`. An auditor model (`step-5-preview` by default;
  change it with `--model`) labels each Stu reply:
  - `onTopic`: whether it stays within the notes, or within the syllabus for the no-notes topic
  - `drift`: `stu` if Stu brought in the outside subject, `teacher` if he followed the teacher's tangent
  - `idea`: which syllabus idea it targets
  - `addedContent`: whether Stu stated facts the teacher never said

  It reports per-scenario, per-persona and per-topic rates. Final progress is the second signal: a chat
  that stays on the notes should move the bar.

Compare two runs by their `grades.json` and `summary.json`. The auditor model and the teacher model are
themselves samples. Treat small differences between runs as noise, and read the transcripts before
concluding anything.

## Results (October 2026)

Two Claude graders labeled every Stu reply in all 24 transcripts (12 before, 12 after), shuffled under
neutral file names so neither knew which version it was reading. One was a strict topic auditor; the other
judged as a teacher using the Feynman technique. Each grader saw only the notes, the idea names, and the
chat.

| | Before | After |
| --- | --- | --- |
| Squarely on the notes | 68% | 89% |
| Off the lesson entirely | 14% | 0% |
| Stu introduced a tangent himself | 5% | 1% |
| Steered back when the teacher drifted | 3 of 34 | 19 of 23 |
| Syllabus ideas reached in 6 turns | 63% | 75% |
| Feynman quality (0–2) | 1.18 | 1.55 |
| Persona kept (short, one real question) | 97% | 98% |
| Stu replies that failed | 4 of 72 | 1 of 72 |
| Stu latency, median / p90 | 6.4 s / 10.5 s | 6.1 s / 9.1 s |

Per teacher, on the notes: follower 64% → 94%, drifter 46% → 92%, diligent 96% → 81%. The diligent drop
came almost entirely from one photosynthesis run where Stu chased the teacher's side remarks. A final prompt
change ("ask about the main point, never a side remark") was checked on the four diligent scenarios plus
photosynthesis-follower: diligent went to 90% on the notes, with the persona kept in every reply and no
leaks. What remains are curiosity questions one step deeper than the notes go, which Stu can't avoid
without seeing the notes, and he deliberately doesn't.

Version log (labels under `results/`): `baseline` is the code before the fix. `fixed-v1` added the lesson
plan, steering and the tangent guard. `fixed-v2` made the reply shape a preference and added a retry pair.
`fixed-v4` had the Judge flag drift and asked Stu for exactly one question. `fixed-v5` added the
main-point rule and plain idea names.

