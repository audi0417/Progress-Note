import type { ClinicalNote, ConsultationSession, MedicationItem, TranscriptSegment } from '../types'

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

export const api = {
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
