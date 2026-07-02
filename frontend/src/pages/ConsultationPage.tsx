import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { demoStore } from '../api/demoStore'
import { DEMO_MODE } from '../config'
import { ClinicalNotePanel } from '../components/ClinicalNotePanel'
import { MicControl } from '../components/MicControl'
import { RoleBanner } from '../components/RoleBanner'
import { TranscriptPanel } from '../components/TranscriptPanel'
import { useAudioStreamer } from '../hooks/useAudioStreamer'
import { useBrowserSpeech } from '../hooks/useBrowserSpeech'
import { useConsultationSocket } from '../hooks/useConsultationSocket'
import type { StoredIdentity } from '../lib/identity'
import type { ClinicalNote, ConsultationSession, PartialTranscript, ServerEvent, SpeakerRole, TranscriptSegment } from '../types'

interface Props {
  identity: StoredIdentity
  onLeave: () => void
}

export function ConsultationPage({ identity, onLeave }: Props) {
  const sessionId = identity.sessionId

  const [session, setSession] = useState<ConsultationSession | null>(null)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [partials, setPartials] = useState<Record<SpeakerRole, PartialTranscript | null>>({
    doctor: null,
    patient: null,
  })
  const [note, setNote] = useState<ClinicalNote | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Demo-mode only: which speaker the browser speech / manual entry is attributed to.
  const [demoSpeaker, setDemoSpeaker] = useState<SpeakerRole>(identity.role)
  const [manualText, setManualText] = useState('')

  useEffect(() => {
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
  }, [sessionId])

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

  // --- Backend mode: WebSocket + PCM audio streaming ---
  const { status: socketStatus, sendAudio } = useConsultationSocket({
    sessionId,
    role: identity.role,
    name: identity.name,
    onEvent: handleServerEvent,
    enabled: !DEMO_MODE,
  })
  const audio = useAudioStreamer(sendAudio)

  // --- Demo mode: in-browser Web Speech API, results written to localStorage ---
  const addFinalSegment = useCallback(
    (speaker: SpeakerRole, text: string) => {
      const segment = demoStore.addSegment(sessionId, speaker, text)
      handleServerEvent({ type: 'transcript_final', segment })
    },
    [sessionId, handleServerEvent],
  )
  const browserSpeech = useBrowserSpeech({
    onPartial: (text) =>
      handleServerEvent({ type: 'transcript_partial', speaker: demoSpeaker, text, start_ms: 0, end_ms: 0 }),
    onFinal: (text) => addFinalSegment(demoSpeaker, text),
  })

  const recorder = DEMO_MODE
    ? {
        isRecording: browserSpeech.isListening,
        start: browserSpeech.start,
        stop: browserSpeech.stop,
        disabled: !browserSpeech.supported,
        error: browserSpeech.supported
          ? browserSpeech.error
          : '此瀏覽器不支援語音辨識，請改用下方手動輸入',
      }
    : {
        isRecording: audio.isRecording,
        start: audio.start,
        stop: audio.stop,
        disabled: socketStatus !== 'open',
        error: audio.error,
      }

  const wsStatus = DEMO_MODE ? 'open' : socketStatus
  const sessionEnded = session?.status === 'ended' || session?.status === 'analyzed'

  useEffect(() => {
    if (sessionEnded && recorder.isRecording) recorder.stop()
  }, [sessionEnded, recorder.isRecording, recorder.stop])

  const handleManualAdd = (e: FormEvent) => {
    e.preventDefault()
    const text = manualText.trim()
    if (!text) return
    addFinalSegment(demoSpeaker, text)
    setManualText('')
  }

  const handleEndSession = async () => {
    if (recorder.isRecording) recorder.stop()
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

  if (loadError) return <div className="page-center">{loadError}</div>
  if (!session) return <div className="page-center">載入中…</div>

  return (
    <div className="consultation-page">
      <RoleBanner session={session} role={identity.role} wsStatus={wsStatus} demo={DEMO_MODE} onLeave={onLeave} />

      <div className="consultation-body">
        <div className="transcript-column">
          <TranscriptPanel
            segments={segments}
            partials={partials}
            canEdit={identity.role === 'doctor'}
            editorName={identity.name}
            onEdit={async (segmentId, text) => {
              try {
                const updated = await api.editSegment(sessionId, segmentId, text, identity.name)
                handleServerEvent({ type: 'segment_edited', segment: updated })
              } catch {
                /* ignore edit failures */
              }
            }}
          />

          {!sessionEnded && (
            <div className="controls-row">
              {DEMO_MODE && (
                <div className="demo-speaker-toggle" role="group" aria-label="目前發言者">
                  <span className="demo-speaker-label">目前發言者</span>
                  <div className="demo-speaker-buttons">
                    <button
                      className={demoSpeaker === 'doctor' ? 'active doctor' : ''}
                      onClick={() => setDemoSpeaker('doctor')}
                    >
                      醫師
                    </button>
                    <button
                      className={demoSpeaker === 'patient' ? 'active patient' : ''}
                      onClick={() => setDemoSpeaker('patient')}
                    >
                      病患
                    </button>
                  </div>
                </div>
              )}

              <MicControl
                isRecording={recorder.isRecording}
                disabled={recorder.disabled}
                error={recorder.error}
                onStart={recorder.start}
                onStop={recorder.stop}
              />

              {DEMO_MODE && (
                <form className="manual-entry" onSubmit={handleManualAdd}>
                  <input
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder={`手動輸入一句（以「${demoSpeaker === 'doctor' ? '醫師' : '病患'}」身份）`}
                  />
                  <button type="submit" className="primary">
                    新增
                  </button>
                </form>
              )}

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
