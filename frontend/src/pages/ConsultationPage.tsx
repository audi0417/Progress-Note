import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { ClinicalNotePanel } from '../components/ClinicalNotePanel'
import { MicControl } from '../components/MicControl'
import { RoleBanner } from '../components/RoleBanner'
import { TranscriptPanel } from '../components/TranscriptPanel'
import { useAudioStreamer } from '../hooks/useAudioStreamer'
import { useConsultationSocket } from '../hooks/useConsultationSocket'
import { loadIdentity } from '../lib/identity'
import type { ClinicalNote, ConsultationSession, PartialTranscript, ServerEvent, SpeakerRole, TranscriptSegment } from '../types'

export function ConsultationPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  const identity = useMemo(() => (sessionId ? loadIdentity(sessionId) : null), [sessionId])

  const [session, setSession] = useState<ConsultationSession | null>(null)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [partials, setPartials] = useState<Record<SpeakerRole, PartialTranscript | null>>({
    doctor: null,
    patient: null,
  })
  const [note, setNote] = useState<ClinicalNote | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    if (!identity) {
      navigate('/')
      return
    }
    ;(async () => {
      try {
        const [sessionData, segmentData] = await Promise.all([
          api.getSession(sessionId),
          api.listSegments(sessionId),
        ])
        setSession(sessionData)
        setSegments(segmentData)
        if (sessionData.status === 'analyzed') {
          const existingNote = await api.getNote(sessionId).catch(() => null)
          if (existingNote) setNote(existingNote)
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : '無法載入診間資料')
      }
    })()
  }, [sessionId, identity, navigate])

  const handleServerEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'transcript_partial':
        setPartials((prev) => ({
          ...prev,
          [event.speaker]: { speaker: event.speaker, text: event.text, start_ms: event.start_ms, end_ms: event.end_ms },
        }))
        break
      case 'transcript_final':
        setSegments((prev) =>
          prev.some((s) => s.id === event.segment.id) ? prev : [...prev, event.segment].sort((a, b) => a.sequence - b.sequence),
        )
        setPartials((prev) => ({ ...prev, [event.segment.speaker]: null }))
        break
      case 'segment_edited':
        setSegments((prev) => prev.map((s) => (s.id === event.segment.id ? event.segment : s)))
        break
      case 'session_ended':
        setSession((prev) => (prev ? { ...prev, status: 'ended' } : prev))
        setAnalyzing(true)
        break
      case 'analysis_ready':
        setNote(event.note)
        setAnalyzing(false)
        setSession((prev) => (prev ? { ...prev, status: 'analyzed' } : prev))
        break
      case 'note_reviewed':
        setNote(event.note)
        break
    }
  }, [])

  const { status: wsStatus, sendAudio } = useConsultationSocket({
    sessionId: sessionId ?? null,
    role: identity?.role ?? 'doctor',
    name: identity?.name ?? '',
    onEvent: handleServerEvent,
    enabled: Boolean(sessionId && identity),
  })

  const { isRecording, start, stop, error: micError } = useAudioStreamer(sendAudio)

  const sessionEnded = session?.status === 'ended' || session?.status === 'analyzed'

  useEffect(() => {
    if (sessionEnded && isRecording) stop()
  }, [sessionEnded, isRecording, stop])

  const handleEndSession = async () => {
    if (!sessionId) return
    if (isRecording) stop()
    setAnalyzing(true)
    try {
      const generatedNote = await api.endSession(sessionId)
      setNote(generatedNote)
      setAnalyzing(false)
      setSession((prev) => (prev ? { ...prev, status: 'analyzed' } : prev))
    } catch (err) {
      setAnalyzing(false)
      setLoadError(err instanceof Error ? err.message : '結束問診時發生錯誤')
    }
  }

  if (!sessionId || !identity) return null
  if (loadError) return <div className="page-center">{loadError}</div>
  if (!session) return <div className="page-center">載入中…</div>

  return (
    <div className="consultation-page">
      <RoleBanner session={session} role={identity.role} wsStatus={wsStatus} />

      <div className="consultation-body">
        <div className="transcript-column">
          <TranscriptPanel
            segments={segments}
            partials={partials}
            canEdit={identity.role === 'doctor'}
            editorName={identity.name}
            onEdit={(segmentId, text) => {
              api.editSegment(sessionId, segmentId, text, identity.name).catch(() => undefined)
            }}
          />

          {!sessionEnded && (
            <div className="controls-row">
              <MicControl
                isRecording={isRecording}
                disabled={wsStatus !== 'open'}
                error={micError}
                onStart={start}
                onStop={stop}
              />
              {identity.role === 'doctor' && (
                <button className="danger" onClick={handleEndSession}>
                  結束問診並產生摘要
                </button>
              )}
            </div>
          )}
        </div>

        <div className="note-column">
          <ClinicalNotePanel
            sessionId={sessionId}
            role={identity.role}
            note={note}
            analyzing={analyzing && !note}
            onUpdated={setNote}
          />
        </div>
      </div>
    </div>
  )
}
