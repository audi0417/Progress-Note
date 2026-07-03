import { useState } from 'react'
import type { ParticipantRole, TranscriptSegment } from '../types'

interface Props {
  segments: TranscriptSegment[]
  partial: string | null
  canEdit: boolean
  editorName: string
  onEdit: (segmentId: string, text: string) => void
  onSetSpeaker: (segmentId: string, speaker: ParticipantRole) => void
}

interface SpeakerMeta {
  label: string
  cls: string
}

function speakerMeta(seg: TranscriptSegment): SpeakerMeta {
  if (seg.speaker === 'doctor') return { label: '醫師', cls: 'doctor' }
  if (seg.speaker === 'patient') return { label: '病患', cls: 'patient' }
  if (seg.speaker_label) {
    const idx = Number.parseInt(seg.speaker_label.replace(/\D/g, ''), 10) || 0
    const letter = String.fromCharCode(65 + (idx % 2)) // A / B
    return { label: `說話者 ${letter}`, cls: `spk spk-${idx % 2}` }
  }
  return { label: '待標記', cls: 'pending' }
}

export function TranscriptPanel({ segments, partial, canEdit, editorName, onEdit, onSetSpeaker }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startEdit = (segment: TranscriptSegment) => {
    if (!canEdit) return
    setEditingId(segment.id)
    setDraft(segment.edited_text ?? segment.original_text)
  }

  const commitEdit = () => {
    if (editingId && draft.trim()) onEdit(editingId, draft.trim())
    setEditingId(null)
  }

  if (segments.length === 0 && !partial) {
    return (
      <div className="transcript-panel empty">
        <p>尚無逐字稿。開始錄音後，對話內容會即時顯示於此。</p>
      </div>
    )
  }

  return (
    <div className="transcript-panel">
      {segments.map((segment) => {
        const meta = speakerMeta(segment)
        return (
          <div key={segment.id} className={`transcript-line ${meta.cls}`}>
            <span className="speaker-tag">{meta.label}</span>
            <div className="line-body">
              {editingId === segment.id ? (
                <div className="edit-row">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={2} />
                  <div className="edit-actions">
                    <button onClick={commitEdit}>儲存</button>
                    <button className="ghost" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className={`line-text ${canEdit ? 'editable' : ''}`} onClick={() => startEdit(segment)}>
                    {segment.edited_text ?? segment.original_text}
                    {segment.edited_text !== null && <span className="edited-badge">已校正</span>}
                  </p>
                  {canEdit && (
                    <div className="speaker-assign">
                      <button
                        className={segment.speaker === 'doctor' ? 'active doctor' : ''}
                        onClick={() => onSetSpeaker(segment.id, 'doctor')}
                      >
                        醫師
                      </button>
                      <button
                        className={segment.speaker === 'patient' ? 'active patient' : ''}
                        onClick={() => onSetSpeaker(segment.id, 'patient')}
                      >
                        病患
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}

      {partial && (
        <div className="transcript-line pending partial">
          <span className="speaker-tag">辨識中</span>
          <div className="line-body">
            <p className="line-text">{partial}</p>
          </div>
        </div>
      )}

      {canEdit && segments.length > 0 && (
        <p className="edit-hint">點句子可校正文字、下方按鈕可指定說話者（操作者：{editorName}）</p>
      )}
    </div>
  )
}
