from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import SessionStatus, SpeakerRole


# ---------- Sessions ----------

class SessionCreateRequest(BaseModel):
    doctor_name: str = Field(min_length=1, max_length=120)


class SessionJoinRequest(BaseModel):
    join_code: str = Field(min_length=1, max_length=8)
    patient_name: str = Field(min_length=1, max_length=120)


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    join_code: str
    doctor_name: str
    patient_name: str | None
    status: SessionStatus
    created_at: datetime
    ended_at: datetime | None


# ---------- Transcript segments ----------

class TranscriptSegmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    sequence: int
    speaker: SpeakerRole
    original_text: str
    edited_text: str | None
    is_final: bool
    start_ms: int
    end_ms: int
    created_at: datetime
    edited_at: datetime | None
    edited_by: str | None

    @property
    def display_text(self) -> str:
        return self.edited_text if self.edited_text is not None else self.original_text


class TranscriptEditRequest(BaseModel):
    text: str = Field(min_length=1)
    edited_by: str = Field(min_length=1, max_length=120)


# ---------- Clinical note ----------

class MedicationItem(BaseModel):
    name: str
    dosage: str = ""
    instructions: str = ""


class ClinicalNoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    diagnosis_summary: str
    treatment_plan: str
    patient_summary: str
    follow_up: str
    warning_signs: str
    medications: list[MedicationItem]
    generated_at: datetime
    reviewed_by_doctor: bool
    reviewed_at: datetime | None


class ClinicalNoteReviewRequest(BaseModel):
    diagnosis_summary: str | None = None
    treatment_plan: str | None = None
    patient_summary: str | None = None
    follow_up: str | None = None
    warning_signs: str | None = None
    medications: list[MedicationItem] | None = None
    approve: bool = True
