import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _short_code() -> str:
    return uuid.uuid4().hex[:6].upper()


class SessionStatus(str, enum.Enum):
    WAITING = "waiting"       # created by doctor, waiting for patient to join
    ACTIVE = "active"         # consultation in progress
    ENDED = "ended"           # doctor ended the consultation
    ANALYZED = "analyzed"     # AI analysis complete, note ready


class SpeakerRole(str, enum.Enum):
    DOCTOR = "doctor"
    PATIENT = "patient"
    # Recorded before the speaker's role is known. In the single-stream model
    # the microphone captures the whole room, so a segment starts as UNKNOWN
    # (carrying a raw diarization cluster in ``speaker_label``) and is resolved
    # to DOCTOR / PATIENT at the end of the consultation (LLM role mapping) or
    # by a manual correction.
    UNKNOWN = "unknown"


class ConsultationSession(Base):
    __tablename__ = "consultation_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    join_code: Mapped[str] = mapped_column(String(8), unique=True, index=True, default=_short_code)

    doctor_name: Mapped[str] = mapped_column(String(120))
    patient_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus), default=SessionStatus.WAITING
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    segments: Mapped[list["TranscriptSegment"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="TranscriptSegment.sequence"
    )
    note: Mapped["ClinicalNote | None"] = relationship(
        back_populates="session", cascade="all, delete-orphan", uselist=False
    )


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("consultation_sessions.id"))
    sequence: Mapped[int] = mapped_column(default=0)

    speaker: Mapped[SpeakerRole] = mapped_column(Enum(SpeakerRole), default=SpeakerRole.UNKNOWN)
    # Raw diarization cluster (e.g. "speaker_0"), assigned live by the
    # diarizer before the role is resolved. Kept for audit / manual re-mapping.
    speaker_label: Mapped[str | None] = mapped_column(String(32), nullable=True)
    original_text: Mapped[str] = mapped_column(Text)
    edited_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    is_final: Mapped[bool] = mapped_column(default=True)
    start_ms: Mapped[int] = mapped_column(default=0)
    end_ms: Mapped[int] = mapped_column(default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    edited_by: Mapped[str | None] = mapped_column(String(120), nullable=True)

    session: Mapped[ConsultationSession] = relationship(back_populates="segments")

    @property
    def display_text(self) -> str:
        return self.edited_text if self.edited_text is not None else self.original_text


class ClinicalNote(Base):
    __tablename__ = "clinical_notes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("consultation_sessions.id"), unique=True)

    # Clinician-facing content
    diagnosis_summary: Mapped[str] = mapped_column(Text)
    treatment_plan: Mapped[str] = mapped_column(Text)

    # Patient-facing content (plain language)
    patient_summary: Mapped[str] = mapped_column(Text)
    follow_up: Mapped[str] = mapped_column(Text)
    warning_signs: Mapped[str] = mapped_column(Text)
    medications: Mapped[list] = mapped_column(JSON, default=list)

    raw_llm_response: Mapped[dict] = mapped_column(JSON, default=dict)

    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reviewed_by_doctor: Mapped[bool] = mapped_column(default=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    session: Mapped[ConsultationSession] = relationship(back_populates="note")
