import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ClinicalNote, MedicationItem, SpeakerRole } from '../types'

interface Props {
  sessionId: string
  role: SpeakerRole
  note: ClinicalNote | null
  analyzing: boolean
  onUpdated: (note: ClinicalNote) => void
}

export function ClinicalNotePanel({ sessionId, role, note, analyzing, onUpdated }: Props) {
  const [draft, setDraft] = useState<ClinicalNote | null>(note)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setDraft(note), [note])

  if (analyzing) {
    return (
      <div className="note-panel">
        <p className="analyzing">AI 正在整理本次診斷內容，請稍候…</p>
      </div>
    )
  }

  if (!note || !draft) {
    return (
      <div className="note-panel">
        <p className="analyzing">問診結束後，這裡會顯示 AI 整理的診斷摘要。</p>
      </div>
    )
  }

  if (role === 'patient' && !note.reviewed_by_doctor) {
    return (
      <div className="note-panel">
        <p className="analyzing">醫師正在確認本次診斷內容，確認後會立即顯示於此。</p>
      </div>
    )
  }

  const updateMedication = (index: number, field: keyof MedicationItem, value: string) => {
    const meds = [...draft.medications]
    meds[index] = { ...meds[index], [field]: value }
    setDraft({ ...draft, medications: meds })
  }

  const addMedication = () => {
    setDraft({ ...draft, medications: [...draft.medications, { name: '', dosage: '', instructions: '' }] })
  }

  const removeMedication = (index: number) => {
    setDraft({ ...draft, medications: draft.medications.filter((_, i) => i !== index) })
  }

  const save = async (approve: boolean) => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const updated = await api.reviewNote(sessionId, {
        diagnosis_summary: draft.diagnosis_summary,
        treatment_plan: draft.treatment_plan,
        patient_summary: draft.patient_summary,
        follow_up: draft.follow_up,
        warning_signs: draft.warning_signs,
        medications: draft.medications,
        approve,
      })
      onUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  if (role === 'doctor') {
    return (
      <div className="note-panel doctor-edit">
        {!note.reviewed_by_doctor && (
          <p className="review-hint">請確認 AI 產生的內容，修改後按下方按鈕釋出給病患。</p>
        )}
        {note.reviewed_by_doctor && <p className="review-hint approved">✓ 已確認並釋出給病患</p>}

        <label>
          臨床摘要與初步診斷
          <textarea
            rows={3}
            value={draft.diagnosis_summary}
            onChange={(e) => setDraft({ ...draft, diagnosis_summary: e.target.value })}
          />
        </label>
        <label>
          處置計畫
          <textarea
            rows={3}
            value={draft.treatment_plan}
            onChange={(e) => setDraft({ ...draft, treatment_plan: e.target.value })}
          />
        </label>
        <label>
          病患說明（白話文）
          <textarea
            rows={3}
            value={draft.patient_summary}
            onChange={(e) => setDraft({ ...draft, patient_summary: e.target.value })}
          />
        </label>

        <div className="medication-editor">
          <span>用藥資訊</span>
          {draft.medications.map((med, i) => (
            <div key={i} className="medication-row">
              <input
                placeholder="藥名"
                value={med.name}
                onChange={(e) => updateMedication(i, 'name', e.target.value)}
              />
              <input
                placeholder="劑量"
                value={med.dosage}
                onChange={(e) => updateMedication(i, 'dosage', e.target.value)}
              />
              <input
                placeholder="服用說明"
                value={med.instructions}
                onChange={(e) => updateMedication(i, 'instructions', e.target.value)}
              />
              <button className="ghost" onClick={() => removeMedication(i)}>
                移除
              </button>
            </div>
          ))}
          <button className="ghost" onClick={addMedication}>
            + 新增藥物
          </button>
        </div>

        <label>
          後續追蹤建議
          <textarea
            rows={2}
            value={draft.follow_up}
            onChange={(e) => setDraft({ ...draft, follow_up: e.target.value })}
          />
        </label>
        <label>
          警訊 / 何時應立即就醫
          <textarea
            rows={2}
            value={draft.warning_signs}
            onChange={(e) => setDraft({ ...draft, warning_signs: e.target.value })}
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <div className="note-actions">
          <button className="ghost" disabled={saving} onClick={() => save(false)}>
            儲存草稿
          </button>
          <button className="primary" disabled={saving} onClick={() => save(true)}>
            確認並釋出給病患
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="note-panel patient-view">
      <section className="note-card summary">
        <h3>本次看診摘要</h3>
        <p>{note.patient_summary}</p>
      </section>

      {note.medications.length > 0 && (
        <section className="note-card medications">
          <h3>用藥資訊</h3>
          <ul>
            {note.medications.map((med, i) => (
              <li key={i}>
                <strong>{med.name}</strong>
                {med.dosage && <span className="med-dosage">{med.dosage}</span>}
                {med.instructions && <div className="med-instructions">{med.instructions}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="note-card followup">
        <h3>後續追蹤</h3>
        <p>{note.follow_up}</p>
      </section>

      <section className="note-card warning">
        <h3>請留意</h3>
        <p>{note.warning_signs}</p>
      </section>
    </div>
  )
}
