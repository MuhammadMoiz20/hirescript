import os
import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_AGENT_SMOKE") != "1",
    reason="set RUN_AGENT_SMOKE=1 to run live agent smoke",
)


async def test_agent_smoke_returns_text():
    from claude_agent_sdk import query

    chunks = []
    async for msg in query(prompt="Reply with the single word: pong"):
        chunks.append(msg)
    assert chunks
