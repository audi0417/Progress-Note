export type SessionStatus = 'waiting' | 'active' | 'ended' | 'analyzed'
// 'unknown' = captured before the speaker's role is resolved (single-stream
// recording); carries a diarization cluster in `speaker_label` until mapped.
export type SpeakerRole = 'doctor' | 'patient' | 'unknown'
// The role a person uses the app as (never 'unknown').
export type ParticipantRole = 'doctor' | 'patient'

export interface ConsultationSession {
  id: string
  join_code: string
  doctor_name: string
  patient_name: string | null
  status: SessionStatus
  created_at: string
  ended_at: string | null
}

export interface TranscriptSegment {
  id: string
  session_id: string
  sequence: number
  speaker: SpeakerRole
  speaker_label: string | null
  original_text: string
  edited_text: string | null
  is_final: boolean
  start_ms: number
  end_ms: number
  created_at: string
  edited_at: string | null
  edited_by: string | null
}

export interface MedicationItem {
  name: string
  dosage: string
  instructions: string
}

export interface ClinicalNote {
  id: string
  session_id: string
  diagnosis_summary: string
  treatment_plan: string
  patient_summary: string
  follow_up: string
  warning_signs: string
  medications: MedicationItem[]
  generated_at: string
  reviewed_by_doctor: boolean
  reviewed_at: string | null
}

export type ServerEvent =
  | { type: 'participant_joined'; role: ParticipantRole; name: string }
  | { type: 'participant_left'; role: ParticipantRole; name: string }
  | { type: 'transcript_partial'; text: string; start_ms: number; end_ms: number }
  | { type: 'transcript_final'; segment: TranscriptSegment }
  | { type: 'segment_edited'; segment: TranscriptSegment }
  | { type: 'segments_relabeled'; segments: TranscriptSegment[] }
  | { type: 'session_ended' }
  | { type: 'analysis_ready'; note: ClinicalNote }
  | { type: 'note_reviewed'; note: ClinicalNote }
  | { type: 'pong' }
