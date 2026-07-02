import { useState } from 'react'
import type { PartialTranscript, SpeakerRole, TranscriptSegment } from '../types'

interface Props {
  segments: TranscriptSegment[]
  partials: Record<SpeakerRole, PartialTranscript | null>
  canEdit: boolean
  editorName: string
  onEdit: (segmentId: string, text: string) => void
}

const speakerLabel: Record<SpeakerRole, string> = { doctor: '醫師', patient: '病患' }

export function TranscriptPanel({ segments, partials, canEdit, editorName, onEdit }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startEdit = (segment: TranscriptSegment) => {
    if (!canEdit) return
    setEditingId(segment.id)
    setDraft(segment.edited_text ?? segment.original_text)
  }

  const commitEdit = () => {
    if (editingId && draft.trim()) {
      onEdit(editingId, draft.trim())
    }
    setEditingId(null)
  }

  if (segments.length === 0 && !partials.doctor && !partials.patient) {
    return (
      <div className="transcript-panel empty">
        <p>尚無逐字稿。開始錄音後，對話內容會即時顯示於此。</p>
      </div>
    )
  }

  return (
    <div className="transcript-panel">
      {segments.map((segment) => (
        <div key={segment.id} className={`transcript-line ${segment.speaker}`}>
          <span className="speaker-tag">{speakerLabel[segment.speaker]}</span>
          {editingId === segment.id ? (
            <div className="edit-row">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                rows={2}
              />
              <div className="edit-actions">
                <button onClick={commitEdit}>儲存</button>
                <button className="ghost" onClick={() => setEditingId(null)}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            <p className={`line-text ${canEdit ? 'editable' : ''}`} onClick={() => startEdit(segment)}>
              {segment.edited_text ?? segment.original_text}
              {segment.edited_text !== null && <span className="edited-badge">已校正</span>}
            </p>
          )}
        </div>
      ))}

      {(['doctor', 'patient'] as SpeakerRole[]).map((role) =>
        partials[role] ? (
          <div key={`partial-${role}`} className={`transcript-line ${role} partial`}>
            <span className="speaker-tag">{speakerLabel[role]}</span>
            <p className="line-text">{partials[role]?.text}</p>
          </div>
        ) : null,
      )}

      {canEdit && (
        <p className="edit-hint">點擊任一句子可即時校正內容（校正者：{editorName}）</p>
      )}
    </div>
  )
}
