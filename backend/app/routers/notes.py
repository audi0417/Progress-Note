from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ClinicalNote, ConsultationSession, SessionStatus, TranscriptSegment
from app.schemas import (
    ClinicalNoteOut,
    ClinicalNoteReviewRequest,
    TranscriptEditRequest,
    TranscriptSegmentOut,
)
from app.services.analysis_service import analyze_transcript
from app.services.connection_manager import manager

router = APIRouter(prefix="/api/sessions", tags=["notes"])


async def _get_session_or_404(session_id: str, db: AsyncSession) -> ConsultationSession:
    session = await db.get(ConsultationSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/{session_id}/segments", response_model=list[TranscriptSegmentOut])
async def list_segments(session_id: str, db: AsyncSession = Depends(get_db)):
    await _get_session_or_404(session_id, db)
    result = await db.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.session_id == session_id)
        .order_by(TranscriptSegment.sequence)
    )
    return result.scalars().all()


@router.patch("/{session_id}/segments/{segment_id}", response_model=TranscriptSegmentOut)
async def edit_segment(
    session_id: str, segment_id: str, payload: TranscriptEditRequest, db: AsyncSession = Depends(get_db)
):
    await _get_session_or_404(session_id, db)
    segment = await db.get(TranscriptSegment, segment_id)
    if segment is None or segment.session_id != session_id:
        raise HTTPException(status_code=404, detail="Transcript segment not found")

    segment.edited_text = payload.text
    segment.edited_by = payload.edited_by
    segment.edited_at = datetime.utcnow()
    await db.commit()
    await db.refresh(segment)

    await manager.broadcast(
        session_id,
        {
            "type": "segment_edited",
            "segment": TranscriptSegmentOut.model_validate(segment).model_dump(mode="json"),
        },
    )
    return segment


@router.post("/{session_id}/end", response_model=ClinicalNoteOut)
async def end_session(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await _get_session_or_404(session_id, db)

    if session.status not in (SessionStatus.ACTIVE, SessionStatus.WAITING):
        existing = await db.execute(select(ClinicalNote).where(ClinicalNote.session_id == session_id))
        note = existing.scalar_one_or_none()
        if note is not None:
            return note
        raise HTTPException(status_code=400, detail="Session already ended without a note; contact support")

    session.status = SessionStatus.ENDED
    session.ended_at = datetime.utcnow()
    await db.commit()

    await manager.broadcast(session_id, {"type": "session_ended"})

    result = await db.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.session_id == session_id)
        .order_by(TranscriptSegment.sequence)
    )
    segments = result.scalars().all()

    analysis = await analyze_transcript(segments)

    note = ClinicalNote(
        session_id=session_id,
        diagnosis_summary=analysis.get("diagnosis_summary", ""),
        treatment_plan=analysis.get("treatment_plan", ""),
        patient_summary=analysis.get("patient_summary", ""),
        follow_up=analysis.get("follow_up", ""),
        warning_signs=analysis.get("warning_signs", ""),
        medications=analysis.get("medications", []),
        raw_llm_response=analysis.get("raw", {}),
    )
    db.add(note)
    session.status = SessionStatus.ANALYZED
    await db.commit()
    await db.refresh(note)

    await manager.broadcast(
        session_id,
        {"type": "analysis_ready", "note": ClinicalNoteOut.model_validate(note).model_dump(mode="json")},
    )
    return note


@router.get("/{session_id}/note", response_model=ClinicalNoteOut)
async def get_note(session_id: str, db: AsyncSession = Depends(get_db)):
    await _get_session_or_404(session_id, db)
    result = await db.execute(select(ClinicalNote).where(ClinicalNote.session_id == session_id))
    note = result.scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not generated yet; end the session first")
    return note


@router.patch("/{session_id}/note", response_model=ClinicalNoteOut)
async def review_note(session_id: str, payload: ClinicalNoteReviewRequest, db: AsyncSession = Depends(get_db)):
    await _get_session_or_404(session_id, db)
    result = await db.execute(select(ClinicalNote).where(ClinicalNote.session_id == session_id))
    note = result.scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not generated yet; end the session first")

    updates = payload.model_dump(exclude_unset=True, exclude={"approve"})
    for field, value in updates.items():
        if field == "medications" and value is not None:
            value = [item if isinstance(item, dict) else item.model_dump() for item in value]
        setattr(note, field, value)

    if payload.approve:
        note.reviewed_by_doctor = True
        note.reviewed_at = datetime.utcnow()

    await db.commit()
    await db.refresh(note)

    await manager.broadcast(
        session_id,
        {"type": "note_reviewed", "note": ClinicalNoteOut.model_validate(note).model_dump(mode="json")},
    )
    return note
