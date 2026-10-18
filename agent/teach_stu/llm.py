"""Two LLM backends behind one tiny interface.

    await text(role, system, messages)       -> str
    await structured(role, system, messages) -> dict (parsed JSON)

`role` is "judge" or "stu" so each can use its own provider/model: the judge has to be
right, so it gets the stronger model; Stu has to be fast, so it gets the quick one.
Providers: asi1 (OpenAI-compatible, api.asi1.ai) and anthropic.
"""

import json
import os
import re

import httpx


class LLMError(Exception):
    pass


def _provider(role: str) -> str:
    explicit = os.getenv(f"{role.upper()}_PROVIDER")
    if explicit:
        return explicit
    if role == "judge" and os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    return "asi1" if os.getenv("ASI_ONE_API_KEY") else "anthropic"


def _model(role: str, provider: str) -> str:
    override = os.getenv(f"{role.upper()}_MODEL")
    if override:
        return override
    if provider == "anthropic":
        return "claude-opus-5-5" if role == "judge" else "claude-haiku-5-5"
    return os.getenv("ASI_MODEL", "asi1")


def describe() -> str:
    return ", ".join(f"{r}={_provider(r)}:{_model(r, _provider(r))}" for r in ("judge", "stu"))


async def _asi1(model: str, system: str, messages: list[dict], json_mode: bool) -> str:
    key = os.getenv("ASI_ONE_API_KEY")
    if not key:
        raise LLMError("ASI_ONE_API_KEY is not set.")
    body = {"model": model, "messages": [{"role": "system", "content": system}, *messages], "temperature": 0.7}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
        body["temperature"] = 0.2
    last = None
    for _ in range(2):  # one retry on network errors / 5xx
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                r = await client.post(
                    "https://api.asi1.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json=body,
                )
            if r.status_code >= 500:
                last = LLMError(f"ASI:One error {r.status_code}")
                continue
            if r.status_code >= 400:
                raise LLMError(f"ASI:One error {r.status_code}: {r.text[:200]}")
            content = r.json()["choices"][0]["message"]["content"]
            if not content:
                raise LLMError("ASI:One returned an empty answer.")
            return content.strip()
        except httpx.HTTPError as e:
            last = LLMError(f"Couldn't reach ASI:One ({e.__class__.__name__}).")
    raise last


_anthropic_client = None


async def _anthropic(model: str, system: str, messages: list[dict], json_mode: bool) -> str:
    global _anthropic_client
    import anthropic

    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(max_retries=2)
    try:
        r = await _anthropic_client.messages.create(
            model=model, max_tokens=4000, system=system, messages=messages
        )
    except anthropic.APIError as e:
        raise LLMError(f"Anthropic error: {e}") from e
    return "".join(b.text for b in r.content if b.type == "text").strip()


async def text(role: str, system: str, messages: list[dict]) -> str:
    p = _provider(role)
    fn = _anthropic if p == "anthropic" else _asi1
    return await fn(_model(role, p), system, messages, False)


def _parse_json(raw: str):
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return None


async def structured(role: str, system: str, messages: list[dict], validate) -> dict:
    """JSON call, validated by `validate(obj) -> obj | None`, retried once on bad output."""
    p = _provider(role)
    fn = _anthropic if p == "anthropic" else _asi1
    for _ in range(2):
        out = _parse_json(await fn(_model(role, p), system + "\n\nRespond with JSON only.", messages, True))
        if out is not None:
            checked = validate(out)
            if checked is not None:
                return checked
    raise LLMError("The model returned output in the wrong format.")
