# Teach Stu — ASI:One agent

Learn by teaching. You teach Stu, a deliberately dim AI student, straight from an ASI:One
chat. A hidden judge grades every word you say against your course notes. If you can get
Stu to 100%, you know the material.

## How it works

```
ASI:One chat ──Agent Chat Protocol──▶ teach-stu uAgent (Agentverse mailbox)
                                         │
             setup: title + depth (form card) + pasted notes
                                         │
                       rubric builder ──▶ hidden rubric: Cover / Explain / Connect
                                         │
         every teacher message:  1. JUDGE (notes + rubric, strict, JSON verdict)
                                    └─ server checks each evidence quote was really typed
                                 2. STU (chat transcript + private director note only)
                                         │
                      100% ──▶ RE-LEARN: Stu explains back in your words + quizzes you
```

- **Judge** (stronger model, Claude if `ANTHROPIC_API_KEY` is set, else ASI:One):
  credits only specific, correct statements at the chosen depth, with a verbatim quote.
  Stu's restatements and "yes, exactly" never count; errors block credit; contradictions revoke it.
- **Stu** (fast model): never sees the notes or rubric, so he can't leak answers.
- The user only sees one progress bar ("Stu learned something!" at most). `debug on` reveals
  the judge's verdicts, quotes, problems and Stu's planted mistakes under each reply.
- **Interactive cards**: a form card for topic setup and a review card to start teaching.
  Every step also works by plain text, for clients that don't render cards.
- **Reliability**: invalid model JSON is retried; failed turns are rolled back so the user can
  just resend; per-user locks keep turns ordered while serving many users concurrently.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r agent/requirements.txt
cp .env.example .env   # set ASI_ONE_API_KEY, AGENT_SEED (and optionally ANTHROPIC_API_KEY)
cd agent && ../.venv/bin/python agent.py
```

1. Open the **Agent inspector** link printed on startup → **Connect** → **Mailbox**
   (logged in to agentverse.ai). The agent is now registered on Agentverse.
2. On Agentverse, check the agent's profile (README is `AGENT_README.md`) and that it shows
   *AgentChatProtocol*.
3. Go to [asi1.ai](https://asi1.ai), and chat with the agent (search "Teach Stu", or open it
   from Agentverse with "Chat with Agent"). Say `sample` for an instant demo.

No keys? `MOCK=1 ../.venv/bin/python try_local.py` runs the whole flow in your terminal
with a fake judge and Stu. Drop `MOCK=1` to try the real models locally.

## Commands (typed in chat)
`new` · `sample` · `progress` · `debug on` / `debug off` · `relearn` · `reset` · `help`

## Files
- `agent.py`: uAgent, chat protocol, card wiring
- `teach_stu/engine.py`: session state machine, the two-layer turn, evidence check, cards
- `teach_stu/prompts.py`: rubric / judge / Stu / re-learn prompts (ported from the web version)
- `teach_stu/llm.py`: ASI:One + Anthropic backends, per-role provider and model
