# Teach Stu 🎓

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:education](https://img.shields.io/badge/education-study-green)

**Learn anything by teaching it.** Stu is a cheerful, deliberately dim AI student who knows only what you tell him. Paste your course notes, pick a depth, and teach. A hidden, pessimistic judge grades every word you say against your notes; Stu only "gets it" when you've actually explained it correctly.

## What it does
1. **Setup**: you give a topic title, a depth (Big picture / Exam-ready / Expert) and your course notes. The agent builds a hidden rubric from the notes in three stages: *Cover* every idea, *Explain* each one, *Connect* them.
2. **Teach**: each message runs two models. The **judge** (sees notes + rubric) credits only specific, correct statements and must quote your exact words as evidence; the server rejects any credit whose quote you never typed. **Stu** (sees only the chat) reacts, misreads analogies and asks one confused question at a time.
3. **Re-learn**: at 100%, Stu flips roles, explains the topic back in your own words, corrects anything you taught wrong, and quizzes you.

## Try it
Say **sample** for instant demo notes on photosynthesis, or **new** to use your own. **debug on** reveals the hidden judge's verdicts.

## Example prompts
- "Help me study for my biology exam by teaching"
- "sample"
- "I want to learn the Krebs cycle by explaining it"
