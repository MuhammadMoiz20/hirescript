import os

os.environ.setdefault("APP_PASSWORD", "changeme")
os.environ.setdefault("SESSION_SECRET", "test-secret-for-tests-only")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://hirescript:hirescript@db:5432/hirescript",
)

import pytest


@pytest.fixture(autouse=True)
def _clear_testclient_cookies():
    """Ensure module-level TestClient instances don't leak cookies across tests."""
    yield
    try:
        from tests.test_auth import client as auth_client
        auth_client.cookies.clear()
    except Exception:
        pass
