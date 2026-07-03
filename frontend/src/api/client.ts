import type { ClinicalNote, ConsultationSession, MedicationItem, SpeakerRole, TranscriptSegment } from '../types'
import { DEMO_MODE } from '../config'
import { demoStore } from './demoStore'

const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

// In DEMO_MODE the whole API is served from localStorage in-browser. We wrap
// the synchronous demoStore calls in Promises so callers stay identical.
const demoApi = {
  createSession: (doctor_name: string) => Promise.resolve(demoStore.createSession(doctor_name)),
  joinSession: (join_code: string, patient_name: string) =>
    Promise.resolve(demoStore.joinSession(join_code, patient_name)),
  getSession: (sessionId: string) => Promise.resolve(demoStore.getSession(sessionId)),
  listSegments: (sessionId: string) => Promise.resolve(demoStore.listSegments(sessionId)),
  editSegment: (sessionId: string, segmentId: string, text: string, edited_by: string) =>
    Promise.resolve(demoStore.editSegment(sessionId, segmentId, text, edited_by)),
  setSegmentSpeaker: (sessionId: string, segmentId: string, speaker: SpeakerRole, edited_by: string) =>
    Promise.resolve(demoStore.setSegmentSpeaker(sessionId, segmentId, speaker, edited_by)),
  endSession: (sessionId: string) => Promise.resolve(demoStore.endSession(sessionId)),
  getNote: (sessionId: string) => Promise.resolve(demoStore.getNote(sessionId)),
  reviewNote: (sessionId: string, updates: Parameters<typeof demoStore.reviewNote>[1]) =>
    Promise.resolve(demoStore.reviewNote(sessionId, updates)),
}

const httpApi = {
  createSession: (doctor_name: string) =>
    request<ConsultationSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ doctor_name }),
    }),

  joinSession: (join_code: string, patient_name: string) =>
    request<ConsultationSession>('/sessions/join', {
      method: 'POST',
      body: JSON.stringify({ join_code, patient_name }),
    }),

  getSession: (sessionId: string) => request<ConsultationSession>(`/sessions/${sessionId}`),

  listSegments: (sessionId: string) =>
    request<TranscriptSegment[]>(`/sessions/${sessionId}/segments`),

  editSegment: (sessionId: string, segmentId: string, text: string, edited_by: string) =>
    request<TranscriptSegment>(`/sessions/${sessionId}/segments/${segmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ text, edited_by }),
    }),

  setSegmentSpeaker: (sessionId: string, segmentId: string, speaker: SpeakerRole, edited_by: string) =>
    request<TranscriptSegment>(`/sessions/${sessionId}/segments/${segmentId}/speaker`, {
      method: 'PATCH',
      body: JSON.stringify({ speaker, edited_by }),
    }),

  endSession: (sessionId: string) =>
    request<ClinicalNote>(`/sessions/${sessionId}/end`, { method: 'POST' }),

  getNote: (sessionId: string) => request<ClinicalNote>(`/sessions/${sessionId}/note`),

  reviewNote: (
    sessionId: string,
    updates: Partial<{
      diagnosis_summary: string
      treatment_plan: string
      patient_summary: string
      follow_up: string
      warning_signs: string
      medications: MedicationItem[]
      approve: boolean
    }>,
  ) =>
    request<ClinicalNote>(`/sessions/${sessionId}/note`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
}

export const api = DEMO_MODE ? demoApi : httpApi
