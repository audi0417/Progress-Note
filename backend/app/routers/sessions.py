from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ConsultationSession, SessionStatus
from app.schemas import SessionCreateRequest, SessionJoinRequest, SessionOut

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionOut)
async def create_session(payload: SessionCreateRequest, db: AsyncSession = Depends(get_db)):
    session = ConsultationSession(doctor_name=payload.doctor_name, status=SessionStatus.WAITING)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.post("/join", response_model=SessionOut)
async def join_session(payload: SessionJoinRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ConsultationSession).where(ConsultationSession.join_code == payload.join_code.upper())
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found for this join code")
    if session.status == SessionStatus.ENDED or session.status == SessionStatus.ANALYZED:
        raise HTTPException(status_code=400, detail="This consultation has already ended")

    session.patient_name = payload.patient_name
    session.status = SessionStatus.ACTIVE
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/{session_id}", response_model=SessionOut)
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await db.get(ConsultationSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session
