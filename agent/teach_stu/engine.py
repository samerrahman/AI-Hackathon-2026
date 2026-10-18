"""Teach Stu conversation engine, independent of uAgents so it can be tested locally.

A session is a plain JSON-able dict (stored per sender in agent storage). `handle()` takes
the session plus one user input and returns a list of Reply objects to send back.

Flow: setup (title -> depth -> notes) -> rubric built -> TEACH (judge + Stu every turn)
-> 100% -> RE-LEARN (Stu explains back and quizzes, using the notes).
"""

import os
import re
from dataclasses import dataclass

from . import llm
from .prompts import (
    DEPTHS,
    STUDENT_NAME,
    depth_of,
    judge_system,
    parse_depth,
    prepare_system,
    review_system,
    stu_direction,
    stu_system,
)
from .sample import SAMPLE

MOCK = os.getenv("MOCK") == "1"
MAX_NOTES_CHARS = 30_000
PROBLEM_KINDS = {"wrong", "vague", "missing_step", "undefined_term", "off_topic"}

HELP = f"""**Teach {STUDENT_NAME}**: you learn by teaching. {STUDENT_NAME} is a cheerful, very dim student who knows only what you tell him. A hidden, strict judge checks every word you say against your course notes. If you can get {STUDENT_NAME} to 100%, you really know it.

Commands (just type them):
- **new**: start a new topic (title, depth, paste your notes)
- **sample**: try it instantly with sample notes on photosynthesis
- **progress**: show {STUDENT_NAME}'s progress bar
- **debug on** / **debug off**: show the hidden judge's verdicts under each reply
- **relearn**: skip to re-learn mode, where {STUDENT_NAME} explains it back and quizzes you
- **reset**: forget everything and start over"""


@dataclass
class Reply:
    text: str
    card: dict | None = None  # {"kind": "form" | "review" | ..., "payload": {...}}
    end_session: bool = False


def new_session() -> dict:
    return {"phase": "idle", "debug": False, "draft": {}, "topic": None, "messages": [], "review": []}


# --- progress ---------------------------------------------------------------------

def all_items(topic: dict) -> list[str]:
    ids = []
    for i in topic["ideas"]:
        ids += [f"cover:{i['id']}", f"explain:{i['id']}"]
    ids += [f"link:{k['id']}" for k in topic["connections"]]
    return ids


def stage_of(topic: dict) -> str:
    c = topic["credited"]
    if not all(f"cover:{i['id']}" in c for i in topic["ideas"]):
        return "cover"
    if not all(f"explain:{i['id']}" in c for i in topic["ideas"]):
        return "explain"
    if not all(f"link:{k['id']}" in c for k in topic["connections"]):
        return "connect"
    return "done"


def percent(topic: dict) -> int:
    items = all_items(topic)
    return round(100 * sum(1 for i in items if i in topic["credited"]) / max(1, len(items)))


def progress_bar(topic: dict) -> str:
    p = percent(topic)
    filled = round(p / 10)
    return f"`{'█' * filled}{'░' * (10 - filled)}` {p}% — {STUDENT_NAME}'s understanding"


def item_name(topic: dict, item: str) -> str:
    kind, _, id_ = item.partition(":")
    if kind == "link":
        return next((k["name"] for k in topic["connections"] if k["id"] == id_), item)
    name = next((i["name"] for i in topic["ideas"] if i["id"] == id_), item)
    return f'what "{name}" is' if kind == "cover" else f'how "{name}" works'


# --- evidence check -----------------------------------------------------------------

def normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def quoted_by_teacher(evidence: str, teacher_text_norm: str) -> bool:
    """The judge's evidence has to be something the teacher actually typed."""
    q = normalize(evidence)
    return len(q.split()) >= 3 and q in teacher_text_norm


# --- validation of model JSON ---------------------------------------------------------

def _validate_rubric(obj):
    if not isinstance(obj, dict) or not isinstance(obj.get("ideas"), list) or not obj["ideas"]:
        return None
    ideas, id_map = [], {}
    for n, i in enumerate(obj["ideas"]):
        if not isinstance(i, dict) or not all(isinstance(i.get(k), str) for k in ("name", "cover", "explain")):
            return None
        new_id = f"i{n + 1}"
        id_map[str(i.get("id", new_id))] = new_id
        ideas.append({"id": new_id, "name": i["name"], "cover": i["cover"], "explain": i["explain"]})
    conns = []
    for k in obj.get("connections") or []:
        if not isinstance(k, dict) or not isinstance(k.get("explain"), str):
            continue
        linked = [id_map[x] for x in k.get("ideas", []) if x in id_map]
        if linked:
            conns.append({"id": f"k{len(conns) + 1}", "name": k.get("name", "Connection"), "ideas": linked, "explain": k["explain"]})
    return {"ideas": ideas, "connections": conns}


def _validate_verdict(obj):
    if not isinstance(obj, dict):
        return None
    credited = [
        {"item": str(c["item"]), "evidence": str(c["evidence"])}
        for c in obj.get("credited") or []
        if isinstance(c, dict) and c.get("item") and c.get("evidence")
    ]
    problems = [
        {"kind": p.get("kind"), "quote": str(p.get("quote", "")), "note": str(p.get("note", ""))}
        for p in obj.get("problems") or []
        if isinstance(p, dict) and p.get("kind") in PROBLEM_KINDS
    ]
    return {
        "credited": credited,
        "revoked": [str(r) for r in obj.get("revoked") or []],
        "problems": problems,
        "stuFocus": str(obj.get("stuFocus") or ""),
        "stuMistake": str(obj.get("stuMistake") or ""),
    }


# --- mock models (MOCK=1, no API keys) --------------------------------------------------

def _mock_rubric(title: str) -> dict:
    return {
        "ideas": [
            {"id": "i1", "name": f"{title} basics", "cover": "what it is", "explain": "how it works"},
            {"id": "i2", "name": f"{title} details", "cover": "what it is", "explain": "how it works"},
        ],
        "connections": [{"id": "k1", "name": "Basics lead to details", "ideas": ["i1", "i2"], "explain": "why"}],
    }


def _mock_verdict(topic: dict, last: str) -> dict:
    words = last.split()
    if len(words) < 8:
        return {"credited": [], "revoked": [], "problems": [{"kind": "vague", "quote": last, "note": "too short"}],
                "stuFocus": "what that even means", "stuMistake": ""}
    nxt = next((i for i in all_items(topic) if i not in topic["credited"]), None)
    return {"credited": [{"item": nxt, "evidence": " ".join(words[:8])}] if nxt else [], "revoked": [],
            "problems": [], "stuFocus": "how that part works", "stuMistake": ""}


# --- the two-layer turn -------------------------------------------------------------------

def _transcript(messages: list[dict]) -> str:
    out = []
    for n, m in enumerate(messages):
        who = "Teacher" if m["role"] == "user" else STUDENT_NAME
        tag = " (NEWEST)" if n == len(messages) - 1 else ""
        out.append(f"{who}{tag}: {m['content']}")
    return "\n\n".join(out)


async def prepare_topic(title: str, depth_key: str, notes: str) -> dict:
    depth = depth_of(depth_key)
    if MOCK:
        rubric = _mock_rubric(title)
    else:
        rubric = await llm.structured(
            "judge",
            prepare_system(depth),
            [{"role": "user", "content": f"Topic: {title}\n\nCourse notes:\n{notes}"}],
            _validate_rubric,
        )
    return {"title": title, "depth": depth_key, "notes": notes, "credited": {}, **rubric}


async def teach_turn(s: dict, text: str) -> tuple[str, dict]:
    """Judge grades the teacher (hidden), then Stu reacts. Returns (stu_reply, verdict_for_debug)."""
    topic = s["topic"]
    depth = depth_of(topic["depth"])
    s["messages"].append({"role": "user", "content": text})
    chat = s["messages"]

    # 1. The judge: sees notes + rubric, grades the whole transcript, focuses on the newest message.
    if MOCK:
        raw = _mock_verdict(topic, text)
    else:
        raw = await llm.structured(
            "judge",
            judge_system(topic, depth),
            [{"role": "user", "content": f"Conversation so far:\n\n{_transcript(chat)}"}],
            _validate_verdict,
        )

    valid = set(all_items(topic))
    teacher_norm = normalize(" \n ".join(m["content"] for m in chat if m["role"] == "user"))
    credited = topic["credited"]
    newly, rejected = [], []
    for c in raw["credited"]:
        if c["item"] not in valid or c["item"] in credited:
            continue
        if not quoted_by_teacher(c["evidence"], teacher_norm):
            rejected.append(c)
            continue
        credited[c["item"]] = c["evidence"]
        newly.append(c)
        kind, _, id_ = c["item"].partition(":")
        if kind == "explain" and f"cover:{id_}" not in credited:  # explaining an idea also names it
            credited[f"cover:{id_}"] = c["evidence"]
    revoked = [r for r in raw["revoked"] if r in credited and all(c["item"] != r for c in newly)]
    for r in revoked:
        del credited[r]

    # 2. Stu: sees ONLY the chat transcript + a director note. Never the notes or rubric.
    stage = stage_of(topic)
    names = [item_name(topic, c["item"]) for c in newly]
    note = stu_direction(names, raw["stuFocus"], raw["stuMistake"], stage)
    if MOCK:
        reply = (f"Ohhh! So {names[0]}? " if names else "Hmm, I don't get it yet. ") + f"But wait, {raw['stuFocus']}?"
    else:
        reply = await llm.text("stu", stu_system(topic) + "\n\n" + note, chat)
    chat.append({"role": "assistant", "content": reply})

    debug = {"credited": newly, "rejected": rejected, "revoked": revoked, "problems": raw["problems"],
             "focus": raw["stuFocus"], "mistake": raw["stuMistake"], "stage": stage}
    return reply, debug


def debug_block(topic: dict, d: dict) -> str:
    lines = [f"\n\n---\n🔍 **Hidden judge** (stage: {d['stage']})"]
    for c in d["credited"]:
        lines.append(f"- ✅ `{c['item']}` {item_name(topic, c['item'])}: “{c['evidence']}”")
    for c in d["rejected"]:
        lines.append(f"- ⛔ dropped `{c['item']}`: quote not found in your messages")
    for r in d["revoked"]:
        lines.append(f"- ↩️ revoked `{r}`")
    for p in d["problems"]:
        lines.append(f"- ⚠️ {p['kind']}: “{p['quote']}” ({p['note']})")
    if d["focus"]:
        lines.append(f"- 🎯 focus for {STUDENT_NAME}: {d['focus']}")
    if d["mistake"]:
        lines.append(f"- 🤪 planted mistake: {d['mistake']}")
    if len(lines) == 1:
        lines.append("- nothing credited, no problems flagged")
    return "\n".join(lines)


# --- cards ------------------------------------------------------------------------------------

def setup_card() -> dict:
    return {
        "kind": "form",
        "payload": {
            "title": f"Teach {STUDENT_NAME} a new topic",
            "fields": [
                {"name": "title", "kind": "text", "label": "Topic title", "required": True,
                 "placeholder": "e.g. Photosynthesis"},
                {"name": "depth", "kind": "select", "label": "How deep do you need to know it?", "required": True,
                 "options": [{"value": k, "label": f"{d['label']}: {d['blurb']}"} for k, d in DEPTHS.items()]},
            ],
            "submit_cta": {"label": "Next: paste notes", "selection": {"action": "setup"}, "primary": True},
        },
    }


def ready_card(topic: dict) -> dict:
    d = depth_of(topic["depth"])
    return {
        "kind": "review",
        "payload": {
            "title": f"Ready to teach {STUDENT_NAME}",
            "summary_rows": [
                {"label": "Topic", "value": topic["title"]},
                {"label": "Depth", "value": d["label"]},
                {"label": "Stages", "value": "Cover the ideas → Explain each → Connect them"},
                {"label": "Progress", "value": f"{percent(topic)}%"},
            ],
            "approve_cta": {"label": "Start teaching", "selection": {"action": "start"}, "primary": True},
            "reject_cta": {"label": "Show hidden judge too", "selection": {"action": "start_debug"}},
        },
    }


# --- main entry ---------------------------------------------------------------------------------

def _depth_menu() -> str:
    return "How deep do you need to know it? Reply **1**, **2** or **3**:\n" + "\n".join(
        f"{n}. **{d['label']}**: {d['blurb']}" for n, d in enumerate(DEPTHS.values(), 1)
    )


async def _finish_setup(s: dict, notes: str) -> list[Reply]:
    draft = s["draft"]
    if len(notes) > MAX_NOTES_CHARS:
        notes = notes[:MAX_NOTES_CHARS]
    try:
        s["topic"] = await prepare_topic(draft["title"], draft["depth"], notes)
    except llm.LLMError as e:
        s["phase"] = "notes"
        return [Reply(f"I couldn't read those notes ({e}). Paste them again to retry.")]
    s.update(phase="ready", messages=[], review=[], draft={})
    t = s["topic"]
    n_ideas = len(t["ideas"])
    return [Reply(
        f"Got it! I read your notes on **{t['title']}** and set up a hidden rubric "
        f"({n_ideas} core ideas plus how they connect) at **{depth_of(t['depth'])['label']}** depth. "
        f"{STUDENT_NAME} knows none of it.\n\nSay **start** (or **start debug** to watch the hidden judge).",
        card=ready_card(t),
    )]


def _start_teaching(s: dict, debug: bool) -> list[Reply]:
    s["phase"] = "teach"
    s["debug"] = debug
    t = s["topic"]
    hi = (f"Hi teacher! I'm {STUDENT_NAME}! 👋 I've heard the words \"{t['title']}\" but I honestly have no idea "
          "what it is. Could you start from the very beginning?")
    s["messages"] = [{"role": "assistant", "content": hi}]
    return [Reply(f"{progress_bar(t)}\n\n**{STUDENT_NAME}:** {hi}")]


async def _enter_review(s: dict) -> str:
    t = s["topic"]
    t["teach_log"] = s["messages"]
    s["phase"] = "review"
    s["review"] = [{"role": "user", "content": "I've finished teaching you. Now explain the whole topic back to me "
                    "in a few sentences using my own examples, fix anything I taught wrong, then quiz me with one question."}]
    if MOCK:
        reply = "Okay! Here's what you taught me... Quiz time: what's the first idea?"
    else:
        reply = await llm.text("stu", review_system(t, depth_of(t["depth"])), s["review"])
    s["review"].append({"role": "assistant", "content": reply})
    return reply


async def handle(s: dict, text: str, selection: dict | None = None) -> list[Reply]:
    text = (text or "").strip()
    cmd = text.lower().strip(" /!.")
    selection = selection or {}

    # Card responses first.
    action = selection.get("action")
    if action == "setup" or ("title" in selection and "depth" in selection):
        s["draft"] = {"title": str(selection.get("title", "")).strip() or "My topic",
                      "depth": selection.get("depth") if selection.get("depth") in DEPTHS else "exam"}
        s["phase"] = "notes"
        return [Reply(f"Great: **{s['draft']['title']}** at **{depth_of(s['draft']['depth'])['label']}** depth. "
                      "Now paste your course notes as your next message (the more complete, the better).")]
    if action in ("start", "start_debug") and s.get("topic"):
        return _start_teaching(s, action == "start_debug")

    # Global commands.
    if cmd in ("help", "hi", "hello", "hey", "menu", "start over") and s["phase"] in ("idle",):
        return [Reply(HELP + "\n\nFill in the card below to set up your first topic, or type **sample** for a demo.",
                      card=setup_card())]
    if cmd == "help":
        return [Reply(HELP)]
    if cmd == "reset":
        s.clear()
        s.update(new_session())
        return [Reply("Reset done. Type **new** to start a topic or **sample** to try a demo.")]
    if cmd in ("new", "new topic"):
        s.update(phase="title", draft={})
        return [Reply("What's the topic called?", card=setup_card())]
    if cmd == "sample":
        s["draft"] = {"title": SAMPLE["title"], "depth": "basics"}
        return [Reply(f"Loading sample notes on **{SAMPLE['title']}** (Big picture depth)...")] + await _finish_setup(s, SAMPLE["notes"])
    if cmd in ("debug on", "debug"):
        s["debug"] = True
        return [Reply("🔍 Hidden judge is now visible under each reply.")]
    if cmd == "debug off":
        s["debug"] = False
        return [Reply("Hidden judge hidden again.")]
    if cmd == "progress":
        return [Reply(progress_bar(s["topic"]) if s.get("topic") else "No topic yet. Type **new**.")]
    if cmd in ("relearn", "re-learn", "review") and s.get("topic"):
        return [Reply(f"🔁 **Re-learn mode.**\n\n**{STUDENT_NAME}:** {await _enter_review(s)}")]

    phase = s["phase"]
    if phase == "idle":
        return [Reply(HELP + "\n\nFill in the card below to set up a topic, or type **new** / **sample**.",
                      card=setup_card())]

    # Chat-based setup (works even if the client doesn't render cards).
    if phase == "title":
        if not text:
            return [Reply("What's the topic called?")]
        s["draft"] = {"title": text[:120]}
        s["phase"] = "depth"
        return [Reply(_depth_menu())]
    if phase == "depth":
        key = parse_depth(text)
        if not key:
            return [Reply("Sorry, I didn't catch that. " + _depth_menu())]
        s["draft"]["depth"] = key
        s["phase"] = "notes"
        return [Reply(f"**{depth_of(key)['label']}** it is. Now paste your course notes as one message.")]
    if phase == "notes":
        if len(text.split()) < 30:
            return [Reply("That's pretty short for course notes. Paste a fuller set (at least a paragraph or two).")]
        return await _finish_setup(s, text)
    if phase == "ready":
        if cmd in ("start", "go", "yes", "start teaching"):
            return _start_teaching(s, s.get("debug", False))
        if cmd in ("start debug", "debug start"):
            return _start_teaching(s, True)
        return [Reply("Say **start** to begin teaching (or **start debug**).")]

    if phase == "teach":
        if not text:
            return [Reply(f"{STUDENT_NAME} is waiting for you to explain something!")]
        before = percent(s["topic"])
        try:
            reply, dbg = await teach_turn(s, text)
        except llm.LLMError as e:
            # Undo the unanswered teacher message so a retry is clean.
            if s["messages"] and s["messages"][-1]["role"] == "user":
                s["messages"].pop()
            return [Reply(f"⚠️ {STUDENT_NAME} zoned out ({e}). Send that again?")]
        t = s["topic"]
        after = percent(t)
        head = progress_bar(t) + (" ✨ Stu learned something!" if after > before else "")
        out = f"{head}\n\n**{STUDENT_NAME}:** {reply}"
        if s.get("debug"):
            out += debug_block(t, dbg)
        replies = [Reply(out)]
        if stage_of(t) == "done":
            replies.append(Reply("🎓 **You taught the whole topic!** Switching to re-learn mode: now Stu explains it "
                                 f"back in your words and quizzes you.\n\n**{STUDENT_NAME}:** {await _enter_review(s)}"))
        return replies

    if phase == "review":
        s["review"].append({"role": "user", "content": text})
        t = s["topic"]
        try:
            reply = MOCK and "Nice answer! Next question..." or await llm.text(
                "stu", review_system(t, depth_of(t["depth"])), s["review"])
        except llm.LLMError as e:
            s["review"].pop()
            return [Reply(f"⚠️ Hiccup ({e}). Send that again?")]
        s["review"].append({"role": "assistant", "content": reply})
        return [Reply(f"**{STUDENT_NAME}:** {reply}")]

    return [Reply(HELP)]
