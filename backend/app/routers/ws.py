import asyncio
import json
import logging
from collections import defaultdict

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models import ConsultationSession, SessionStatus, SpeakerRole, TranscriptSegment
from app.schemas import TranscriptSegmentOut
from app.services.asr import get_asr_engine
from app.services.connection_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter()

# One lock per session guards sequence-number allocation when both the
# doctor and patient connections are writing final segments concurrently.
_session_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


async def _next_sequence(db, session_id: str) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(TranscriptSegment.sequence), -1)).where(
            TranscriptSegment.session_id == session_id
        )
    )
    return result.scalar_one() + 1


async def _persist_final_segment(session_id: str, speaker: SpeakerRole, text: str, start_ms: int, end_ms: int):
    async with _session_locks[session_id]:
        async with AsyncSessionLocal() as db:
            sequence = await _next_sequence(db, session_id)
            segment = TranscriptSegment(
                session_id=session_id,
                sequence=sequence,
                speaker=speaker,
                original_text=text,
                is_final=True,
                start_ms=start_ms,
                end_ms=end_ms,
            )
            db.add(segment)
            await db.commit()
            await db.refresh(segment)
            return segment


@router.websocket("/ws/consultation/{session_id}")
async def consultation_ws(
    websocket: WebSocket,
    session_id: str,
    role: str = Query(..., pattern="^(doctor|patient)$"),
    name: str = Query(default=""),
):
    async with AsyncSessionLocal() as db:
        session = await db.get(ConsultationSession, session_id)
    if session is None:
        await websocket.close(code=4404, reason="Session not found")
        return
    if session.status in (SessionStatus.ENDED, SessionStatus.ANALYZED):
        await websocket.close(code=4409, reason="Session already ended")
        return

    speaker = SpeakerRole.DOCTOR if role == "doctor" else SpeakerRole.PATIENT

    await manager.connect(session_id, websocket)
    engine = get_asr_engine()
    await engine.warmup()
    asr_session = engine.open_session()

    await manager.broadcast(
        session_id, {"type": "participant_joined", "role": role, "name": name}
    )

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                raise WebSocketDisconnect(message.get("code", 1000))

            if "bytes" in message and message["bytes"] is not None:
                events = await asr_session.push_audio(message["bytes"])
                await _handle_events(session_id, speaker, events)

            elif "text" in message and message["text"] is not None:
                await _handle_control_message(session_id, speaker, message["text"])

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Error in consultation websocket for session %s", session_id)
    finally:
        try:
            final_events = await asr_session.finalize()
            await _handle_events(session_id, speaker, final_events)
        except Exception:
            logger.exception("Error finalizing ASR session for %s", session_id)
        await asr_session.close()
        manager.disconnect(session_id, websocket)
        await manager.broadcast(session_id, {"type": "participant_left", "role": role, "name": name})


async def _handle_events(session_id: str, speaker: SpeakerRole, events) -> None:
    for event in events:
        if event.is_final:
            segment = await _persist_final_segment(
                session_id, speaker, event.text, event.start_ms, event.end_ms
            )
            await manager.broadcast(
                session_id,
                {
                    "type": "transcript_final",
                    "segment": TranscriptSegmentOut.model_validate(segment).model_dump(mode="json"),
                },
            )
        else:
            await manager.broadcast(
                session_id,
                {
                    "type": "transcript_partial",
                    "speaker": speaker.value,
                    "text": event.text,
                    "start_ms": event.start_ms,
                    "end_ms": event.end_ms,
                },
            )


async def _handle_control_message(session_id: str, speaker: SpeakerRole, raw: str) -> None:
    try:
        message = json.loads(raw)
    except json.JSONDecodeError:
        return

    if message.get("type") == "ping":
        await manager.broadcast(session_id, {"type": "pong"})
