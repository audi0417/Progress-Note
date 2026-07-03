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
from app.services.diarization import get_diarization_engine
from app.services.connection_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter()

# One lock per session guards sequence-number allocation when several
# connections write final segments concurrently.
_session_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


async def _next_sequence(db, session_id: str) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(TranscriptSegment.sequence), -1)).where(
            TranscriptSegment.session_id == session_id
        )
    )
    return result.scalar_one() + 1


async def _persist_final_segment(session_id: str, speaker_label: str | None, text: str, start_ms: int, end_ms: int):
    async with _session_locks[session_id]:
        async with AsyncSessionLocal() as db:
            sequence = await _next_sequence(db, session_id)
            segment = TranscriptSegment(
                session_id=session_id,
                sequence=sequence,
                # Role is unknown at capture time in the single-stream model;
                # it's resolved from speaker_label at the end of the session.
                speaker=SpeakerRole.UNKNOWN,
                speaker_label=speaker_label,
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

    await manager.connect(session_id, websocket)
    asr_engine = get_asr_engine()
    diar_engine = get_diarization_engine()
    await asr_engine.warmup()
    await diar_engine.warmup()
    asr_session = asr_engine.open_session()
    diarizer = diar_engine.open_session()

    await manager.broadcast(
        session_id, {"type": "participant_joined", "role": role, "name": name}
    )

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                raise WebSocketDisconnect(message.get("code", 1000))

            if "bytes" in message and message["bytes"] is not None:
                audio = message["bytes"]
                # Feed the same audio to both the recognizer and the diarizer.
                await diarizer.push_audio(audio)
                events = await asr_session.push_audio(audio)
                await _handle_events(session_id, diarizer, events)

            elif "text" in message and message["text"] is not None:
                await _handle_control_message(session_id, message["text"])

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Error in consultation websocket for session %s", session_id)
    finally:
        try:
            final_events = await asr_session.finalize()
            await diarizer.finalize()
            await _handle_events(session_id, diarizer, final_events)
        except Exception:
            logger.exception("Error finalizing ASR/diarization session for %s", session_id)
        await asr_session.close()
        await diarizer.close()
        manager.disconnect(session_id, websocket)
        await manager.broadcast(session_id, {"type": "participant_left", "role": role, "name": name})


async def _handle_events(session_id: str, diarizer, events) -> None:
    for event in events:
        if event.is_final:
            speaker_label = await diarizer.assign(event.start_ms, event.end_ms)
            segment = await _persist_final_segment(
                session_id, speaker_label, event.text, event.start_ms, event.end_ms
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
                    "text": event.text,
                    "start_ms": event.start_ms,
                    "end_ms": event.end_ms,
                },
            )


async def _handle_control_message(session_id: str, raw: str) -> None:
    try:
        message = json.loads(raw)
    except json.JSONDecodeError:
        return

    if message.get("type") == "ping":
        await manager.broadcast(session_id, {"type": "pong"})
