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
import type { ClinicalNote, ConsultationSession, ParticipantRole, ServerEvent, TranscriptSegment } from '../types'

interface Props {
  identity: StoredIdentity
  onLeave: () => void
}

export function ConsultationPage({ identity, onLeave }: Props) {
  const sessionId = identity.sessionId
  const isDoctor = identity.role === 'doctor'

  const [session, setSession] = useState<ConsultationSession | null>(null)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [partial, setPartial] = useState<string | null>(null)
  const [note, setNote] = useState<ClinicalNote | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
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
        setPartial(event.text || null)
        break
      case 'transcript_final':
        setSegments((prev) =>
          prev.some((s) => s.id === event.segment.id)
            ? prev
            : [...prev, event.segment].sort((a, b) => a.sequence - b.sequence),
        )
        setPartial(null)
        break
      case 'segment_edited':
        setSegments((prev) => prev.map((s) => (s.id === event.segment.id ? event.segment : s)))
        break
      case 'segments_relabeled':
        setSegments(event.segments.slice().sort((a, b) => a.sequence - b.sequence))
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

  // --- Backend mode: WebSocket + PCM audio streaming (single room stream) ---
  const { status: socketStatus, sendAudio } = useConsultationSocket({
    sessionId,
    role: identity.role,
    name: identity.name,
    onEvent: handleServerEvent,
    enabled: !DEMO_MODE,
  })
  const audio = useAudioStreamer(sendAudio)

  // --- Demo mode: in-browser speech; segments captured without a role,
  // to be assigned per-line afterwards (no diarization in the browser). ---
  const addUnknownSegment = useCallback(
    (text: string) => {
      const segment = demoStore.addSegment(sessionId, 'unknown', text)
      handleServerEvent({ type: 'transcript_final', segment })
    },
    [sessionId, handleServerEvent],
  )
  const browserSpeech = useBrowserSpeech({
    onPartial: (text) => setPartial(text || null),
    onFinal: (text) => addUnknownSegment(text),
  })

  const recorder = DEMO_MODE
    ? {
        isRecording: browserSpeech.isListening,
        start: browserSpeech.start,
        stop: browserSpeech.stop,
        disabled: !browserSpeech.supported,
        error: browserSpeech.supported ? browserSpeech.error : '此瀏覽器不支援語音辨識，請改用下方手動輸入',
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
    addUnknownSegment(text)
    setManualText('')
  }

  const handleSetSpeaker = async (segmentId: string, speaker: ParticipantRole) => {
    try {
      const updated = await api.setSegmentSpeaker(sessionId, segmentId, speaker, identity.name)
      handleServerEvent({ type: 'segment_edited', segment: updated })
    } catch {
      /* ignore */
    }
  }

  const handleEndSession = async () => {
    if (recorder.isRecording) recorder.stop()
    setAnalyzing(true)
    try {
      const generatedNote = await api.endSession(sessionId)
      // Refresh segments so any role relabeling from analysis is reflected.
      const refreshed = await api.listSegments(sessionId).catch(() => null)
      if (refreshed) setSegments(refreshed.slice().sort((a, b) => a.sequence - b.sequence))
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
            partial={partial}
            canEdit={isDoctor}
            editorName={identity.name}
            onEdit={async (segmentId, text) => {
              try {
                const updated = await api.editSegment(sessionId, segmentId, text, identity.name)
                handleServerEvent({ type: 'segment_edited', segment: updated })
              } catch {
                /* ignore */
              }
            }}
            onSetSpeaker={handleSetSpeaker}
          />

          {isDoctor && !sessionEnded && (
            <div className="controls-row">
              <p className="record-hint">
                {DEMO_MODE
                  ? '一支裝置收整個對話即可；Demo 無自動聲音分辨，錄完可逐句指定醫師/病患'
                  : '一支裝置收整個對話即可，系統會自動分辨說話者；錄完可逐句校正'}
              </p>

              <MicControl
                isRecording={recorder.isRecording}
                disabled={recorder.disabled}
                error={recorder.error}
                onStart={recorder.start}
                onStop={recorder.stop}
              />

              <form className="manual-entry" onSubmit={handleManualAdd}>
                <input
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="手動補一句（語音不支援時使用）"
                />
                <button type="submit" className="primary">
                  新增
                </button>
              </form>

              <button className="danger" onClick={handleEndSession}>
                結束問診並產生摘要
              </button>
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
