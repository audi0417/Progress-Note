import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_progress_note.db")
os.environ.setdefault("ASR_BACKEND", "mock")

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import init_db
from app.main import app


@pytest.fixture(autouse=True)
async def _setup_db():
    await init_db()
    yield


@pytest.mark.asyncio
async def test_create_join_edit_end_flow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_resp = await client.post("/api/sessions", json={"doctor_name": "Dr. Lin"})
        assert create_resp.status_code == 200
        session = create_resp.json()
        assert session["status"] == "waiting"
        assert session["join_code"]

        join_resp = await client.post(
            "/api/sessions/join",
            json={"join_code": session["join_code"], "patient_name": "Alice"},
        )
        assert join_resp.status_code == 200
        assert join_resp.json()["status"] == "active"

        segments_resp = await client.get(f"/api/sessions/{session['id']}/segments")
        assert segments_resp.status_code == 200
        assert segments_resp.json() == []

        end_resp = await client.post(f"/api/sessions/{session['id']}/end")
        assert end_resp.status_code == 200
        note = end_resp.json()
        assert "patient_summary" in note

        get_session_resp = await client.get(f"/api/sessions/{session['id']}")
        assert get_session_resp.json()["status"] == "analyzed"


@pytest.mark.asyncio
async def test_join_with_invalid_code_returns_404():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/sessions/join", json={"join_code": "ZZZZZZ", "patient_name": "Bob"}
        )
        assert resp.status_code == 404
