// localStorage-backed stand-in for the FastAPI backend, used in DEMO_MODE
// (GitHub Pages). Mirrors the shapes the real API returns so the rest of the
// app is unaware of which backend it's talking to.
import type { ClinicalNote, ConsultationSession, MedicationItem, SpeakerRole, TranscriptSegment } from '../types'

const KEY = 'progress-note:demo-store'

interface Store {
  sessions: Record<string, ConsultationSession>
  segments: Record<string, TranscriptSegment[]>
  notes: Record<string, ClinicalNote>
}

function load(): Store {
  const raw = localStorage.getItem(KEY)
  if (!raw) return { sessions: {}, segments: {}, notes: {} }
  try {
    const parsed = JSON.parse(raw) as Store
    return { sessions: parsed.sessions ?? {}, segments: parsed.segments ?? {}, notes: parsed.notes ?? {} }
  } catch {
    return { sessions: {}, segments: {}, notes: {} }
  }
}

function save(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store))
}

function uid(): string {
  const raw = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return raw.replace(/-/g, '').slice(0, 32)
}

function joinCode(): string {
  return uid().slice(0, 6).toUpperCase()
}

function now(): string {
  return new Date().toISOString()
}

function fail(detail: string): never {
  throw new Error(detail)
}

export const demoStore = {
  createSession(doctor_name: string): ConsultationSession {
    const store = load()
    const session: ConsultationSession = {
      id: uid(),
      join_code: joinCode(),
      doctor_name,
      patient_name: null,
      status: 'waiting',
      created_at: now(),
      ended_at: null,
    }
    store.sessions[session.id] = session
    store.segments[session.id] = []
    save(store)
    return session
  },

  joinSession(join_code: string, patient_name: string): ConsultationSession {
    const store = load()
    const session = Object.values(store.sessions).find((s) => s.join_code === join_code.toUpperCase())
    if (!session) fail('找不到此診間代碼（Demo 模式下病患需與醫師在同一裝置/瀏覽器）')
    if (session.status === 'ended' || session.status === 'analyzed') fail('此問診已結束')
    session.patient_name = patient_name
    session.status = 'active'
    save(store)
    return session
  },

  getSession(sessionId: string): ConsultationSession {
    const store = load()
    const session = store.sessions[sessionId]
    if (!session) fail('找不到診間')
    return session
  },

  listSegments(sessionId: string): TranscriptSegment[] {
    const store = load()
    return (store.segments[sessionId] ?? []).slice().sort((a, b) => a.sequence - b.sequence)
  },

  addSegment(sessionId: string, speaker: SpeakerRole, text: string): TranscriptSegment {
    const store = load()
    const list = store.segments[sessionId] ?? []
    const segment: TranscriptSegment = {
      id: uid(),
      session_id: sessionId,
      sequence: list.length,
      speaker,
      original_text: text,
      edited_text: null,
      is_final: true,
      start_ms: 0,
      end_ms: 0,
      created_at: now(),
      edited_at: null,
      edited_by: null,
    }
    list.push(segment)
    store.segments[sessionId] = list
    save(store)
    return segment
  },

  editSegment(sessionId: string, segmentId: string, text: string, edited_by: string): TranscriptSegment {
    const store = load()
    const list = store.segments[sessionId] ?? []
    const segment = list.find((s) => s.id === segmentId)
    if (!segment) fail('找不到逐字稿片段')
    segment.edited_text = text
    segment.edited_by = edited_by
    segment.edited_at = now()
    save(store)
    return segment
  },

  endSession(sessionId: string): ClinicalNote {
    const store = load()
    const session = store.sessions[sessionId]
    if (!session) fail('找不到診間')
    if (store.notes[sessionId]) return store.notes[sessionId]

    session.status = 'ended'
    session.ended_at = now()

    const segments = (store.segments[sessionId] ?? []).slice().sort((a, b) => a.sequence - b.sequence)
    const note = buildDemoNote(sessionId, segments)
    store.notes[sessionId] = note
    session.status = 'analyzed'
    save(store)
    return note
  },

  getNote(sessionId: string): ClinicalNote {
    const store = load()
    const note = store.notes[sessionId]
    if (!note) fail('尚未產生摘要，請先結束問診')
    return note
  },

  reviewNote(
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
  ): ClinicalNote {
    const store = load()
    const note = store.notes[sessionId]
    if (!note) fail('尚未產生摘要，請先結束問診')
    const { approve, ...fields } = updates
    Object.assign(note, fields)
    if (approve) {
      note.reviewed_by_doctor = true
      note.reviewed_at = now()
    }
    save(store)
    return note
  },
}

function buildDemoNote(sessionId: string, segments: TranscriptSegment[]): ClinicalNote {
  const transcript = segments
    .map((s) => {
      const who = s.speaker === 'doctor' ? '醫師' : '病患'
      const text = (s.edited_text ?? s.original_text).trim()
      return text ? `${who}：${text}` : ''
    })
    .filter(Boolean)
    .join('\n')

  const snippet = transcript.slice(0, 800) || '（本次對話沒有擷取到逐字稿內容）'

  return {
    id: `note-${sessionId}`,
    session_id: sessionId,
    diagnosis_summary:
      '【Demo 模式：本摘要由前端離線產生，非 AI 分析。以下為逐字稿摘錄】\n' + snippet,
    treatment_plan: '請醫師參考逐字稿手動填寫處置計畫；正式版本會由後端 LLM 自動整理。',
    patient_summary: '本次看診紀錄尚未經過 AI 整理（Demo 模式）。可由醫師手動補充本次看診重點。',
    follow_up: '請依醫師指示安排回診或後續追蹤。',
    warning_signs: '如症狀惡化或出現不適，請儘速回診或聯絡醫療院所。',
    medications: [],
    generated_at: now(),
    reviewed_by_doctor: false,
    reviewed_at: null,
  }
}
