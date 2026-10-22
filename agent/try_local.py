"""Chat with Teach Stu in your terminal, no Agentverse needed: python try_local.py (MOCK=1 for no keys)."""

import asyncio
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from teach_stu import engine  # noqa: E402


async def main():
    s = engine.new_session()
    print("Teach Stu (local). Type 'help'. Ctrl+C to quit.\n")
    while True:
        try:
            text = input("you> ")
        except EOFError:
            return
        for r in await engine.handle(s, text):
            print(f"\n{r.text}\n" + (f"[card: {r.card['kind']}]\n" if r.card else ""))


if __name__ == "__main__":
    asyncio.run(main())
