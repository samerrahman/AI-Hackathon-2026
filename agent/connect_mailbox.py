"""Connect the running agent to its Agentverse mailbox without the inspector page.

1. agentverse.ai -> profile (top right) -> API Keys -> create a key
2. put AGENTVERSE_API_KEY=... in .env
3. with agent.py running:  ../.venv/bin/python connect_mailbox.py
"""

import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

key = os.getenv("AGENTVERSE_API_KEY")
if not key:
    sys.exit("Set AGENTVERSE_API_KEY in .env first (agentverse.ai -> profile -> API Keys).")

port = os.getenv("AGENT_PORT", "8001")
try:
    r = httpx.post(f"http://127.0.0.1:{port}/connect", json={"user_token": key, "agent_type": "mailbox"}, timeout=60)
except httpx.ConnectError:
    sys.exit(f"The agent isn't running on port {port}. Start it with: ../.venv/bin/python agent.py")

print(r.status_code, r.text)
