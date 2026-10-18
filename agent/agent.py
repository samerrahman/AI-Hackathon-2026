"""Teach Stu as a uAgent: Agent Chat Protocol + ASI1 Interactive Cards, reachable from ASI:One.

Run:  python agent.py   (from the agent/ folder, with .env filled in)
The agent connects to Agentverse through its mailbox; open the Inspector link it logs to
connect the mailbox once, then chat with it on asi1.ai.
"""

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# python.org builds on macOS ship without CA certs, which breaks the Agentverse mailbox.
try:
    import certifi

    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

from uagents import Agent, Context, Protocol  # noqa: E402
from uagents_core.contrib.protocols.chat import (  # noqa: E402
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    MetadataContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.contrib.protocols.chat.cards import (  # noqa: E402
    create_card_content,
    extract_card_response,
    validate_card_payload,
)

from teach_stu import engine, llm  # noqa: E402

agent = Agent(
    name=os.getenv("AGENT_NAME", "teach-stu"),
    seed=os.getenv("AGENT_SEED", "teach-stu dev seed change me"),
    port=int(os.getenv("AGENT_PORT", "8001")),
    mailbox=True,
    publish_agent_details=True,
    readme_path=str(Path(__file__).resolve().parent / "AGENT_README.md"),
    description="Learn anything by teaching it to Stu, a deliberately dim AI student. "
    "A hidden judge grades every word against your course notes.",
    handle_messages_concurrently=True,
)

chat = Protocol(spec=chat_protocol_spec)
_locks: dict[str, asyncio.Lock] = {}


def _now():
    return datetime.now(timezone.utc)


def _message(reply: engine.Reply) -> ChatMessage:
    content = [TextContent(type="text", text=reply.text)]
    if reply.card:
        try:
            payload = validate_card_payload(reply.card["kind"], reply.card["payload"])
            content.append(create_card_content(payload, card_id=uuid4()))
        except Exception as e:  # a bad card must never block the text reply
            agent._logger.warning(f"card dropped: {e}")
    if reply.end_session:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=_now(), msg_id=uuid4(), content=content)


def _load(ctx: Context, sender: str) -> dict:
    s = ctx.storage.get(f"s:{sender}")
    return s if isinstance(s, dict) and "phase" in s else engine.new_session()


@chat.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=_now(), acknowledged_msg_id=msg.msg_id))

    text_parts, selection = [], {}
    for c in msg.content:
        if isinstance(c, TextContent):
            text_parts.append(c.text)
        elif isinstance(c, MetadataContent):
            resp = extract_card_response(c)
            if resp:
                selection.update(resp.selection or {})
                if resp.text:
                    text_parts.append(resp.text)
        elif isinstance(c, StartSessionContent):
            pass
    text = "\n".join(text_parts).strip()
    # Some clients send a card selection back as JSON text.
    if not selection and text.startswith("{") and text.endswith("}"):
        try:
            import json

            parsed = json.loads(text)
            if isinstance(parsed, dict):
                selection, text = parsed, ""
        except ValueError:
            pass

    lock = _locks.setdefault(sender, asyncio.Lock())
    async with lock:  # one turn at a time per user, many users in parallel
        s = _load(ctx, sender)
        try:
            replies = await engine.handle(s, text, selection)
        except Exception as e:
            ctx.logger.exception("turn failed")
            replies = [engine.Reply(f"⚠️ Something went wrong on my side ({e.__class__.__name__}). Please try again.")]
        ctx.storage.set(f"s:{sender}", s)

    for r in replies:
        await ctx.send(sender, _message(r))


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


agent.include(chat, publish_manifest=True)


@agent.on_event("startup")
async def startup(ctx: Context):
    ctx.logger.info(f"Teach Stu up at {agent.address}  ({'MOCK' if engine.MOCK else llm.describe()})")


if __name__ == "__main__":
    agent.run()
