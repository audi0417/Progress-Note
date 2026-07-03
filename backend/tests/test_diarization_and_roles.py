import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_progress_note.db")
os.environ.setdefault("ASR_BACKEND", "mock")
os.environ.setdefault("DIARIZATION_BACKEND", "mock")

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import AsyncSessionLocal, init_db
from app.models import SpeakerRole, TranscriptSegment
from app.services.analysis_service import heuristic_speaker_roles
from app.services.diarization.mock import MockStreamingDiarizer
from app.main import app


@pytest.fixture(autouse=True)
async def _setup_db():
    await init_db()
    yield


async def test_mock_diarizer_alternates_on_pause():
    diar = MockStreamingDiarizer(max_speakers=2)
    # Back-to-back (small gap) stays the same speaker; a long pause switches.
    a = await diar.assign(0, 1000)
    b = await diar.assign(1100, 2000)      # 100ms gap -> same speaker
    c = await diar.assign(3000, 4000)      # 1000ms gap -> switch
    d = await diar.assign(5500, 6000)      # switch again
    assert a == "speaker_0"
    assert b == "speaker_0"
    assert c == "speaker_1"
    assert d == "speaker_0"


def test_heuristic_roles_first_speaker_is_doctor():
    segs = [
        TranscriptSegment(session_id="s", sequence=0, speaker_label="speaker_0", original_text="hi"),
        TranscriptSegment(session_id="s", sequence=1, speaker_label="speaker_1", original_text="hello"),
        TranscriptSegment(session_id="s", sequence=2, speaker_label="speaker_0", original_text="again"),
    ]
    roles = heuristic_speaker_roles(segs)
    assert roles == {"speaker_0": "doctor", "speaker_1": "patient"}


async def _seed_segments(session_id: str):
    async with AsyncSessionLocal() as db:
        db.add_all(
            [
                TranscriptSegment(
                    session_id=session_id, sequence=0, speaker=SpeakerRole.UNKNOWN,
                    speaker_label="speaker_0", original_text="您好，哪裡不舒服？", is_final=True,
                ),
                TranscriptSegment(
                    session_id=session_id, sequence=1, speaker=SpeakerRole.UNKNOWN,
                    speaker_label="speaker_1", original_text="我頭痛。", is_final=True,
                ),
            ]
        )
        await db.commit()


async def test_end_session_relabels_speakers_from_diarization():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        session = (await client.post("/api/sessions", json={"doctor_name": "Dr. Lin"})).json()
        await _seed_segments(session["id"])

        # Before ending, segments are unknown with diarization labels.
        segs = (await client.get(f"/api/sessions/{session['id']}/segments")).json()
        assert [s["speaker"] for s in segs] == ["unknown", "unknown"]
        assert [s["speaker_label"] for s in segs] == ["speaker_0", "speaker_1"]

        # Ending runs analysis; with no API key the heuristic maps first->doctor.
        await client.post(f"/api/sessions/{session['id']}/end")

        segs = (await client.get(f"/api/sessions/{session['id']}/segments")).json()
        assert [s["speaker"] for s in segs] == ["doctor", "patient"]


async def test_manual_speaker_override_is_respected_on_end():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        session = (await client.post("/api/sessions", json={"doctor_name": "Dr. Lin"})).json()
        await _seed_segments(session["id"])
        segs = (await client.get(f"/api/sessions/{session['id']}/segments")).json()

        # Manually mark the FIRST (speaker_0) segment as the patient.
        resp = await client.patch(
            f"/api/sessions/{session['id']}/segments/{segs[0]['id']}/speaker",
            json={"speaker": "patient", "edited_by": "Dr. Lin"},
        )
        assert resp.status_code == 200
        assert resp.json()["speaker"] == "patient"

        await client.post(f"/api/sessions/{session['id']}/end")
        segs = (await client.get(f"/api/sessions/{session['id']}/segments")).json()
        # Manual override wins; the other (still-unknown) one gets heuristic-mapped.
        assert segs[0]["speaker"] == "patient"
