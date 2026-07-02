import { useState } from 'react'
import { api } from '../api/client'
import type { StoredIdentity } from '../lib/identity'

type Tab = 'doctor' | 'patient'

interface Props {
  onEnter: (identity: StoredIdentity) => void
}

export function HomePage({ onEnter }: Props) {
  const [tab, setTab] = useState<Tab>('doctor')

  const [doctorName, setDoctorName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [patientName, setPatientName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleCreate = async () => {
    if (!doctorName.trim()) {
      setError('請輸入醫師姓名')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session = await api.createSession(doctorName.trim())
      onEnter({ sessionId: session.id, role: 'doctor', name: doctorName.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立診間失敗')
    } finally {
      setBusy(false)
    }
  }

  const handleJoin = async () => {
    if (!joinCode.trim() || !patientName.trim()) {
      setError('請輸入診間代碼與姓名')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session = await api.joinSession(joinCode.trim().toUpperCase(), patientName.trim())
      onEnter({ sessionId: session.id, role: 'patient', name: patientName.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入診間失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-center">
      <div className="card home-card">
        <h1>Progress Note</h1>
        <p className="subtitle">醫病即時診斷筆記 — 語音轉文字 · 即時校對 · AI 診後摘要</p>

        <div className="tab-switch">
          <button className={tab === 'doctor' ? 'active' : ''} onClick={() => setTab('doctor')}>
            我是醫師
          </button>
          <button className={tab === 'patient' ? 'active' : ''} onClick={() => setTab('patient')}>
            我是病患
          </button>
        </div>

        {tab === 'doctor' ? (
          <div className="form-stack">
            <label>
              醫師姓名
              <input
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="例如：林醫師"
              />
            </label>
            <button className="primary" onClick={handleCreate} disabled={busy}>
              建立新診間
            </button>
          </div>
        ) : (
          <div className="form-stack">
            <label>
              診間代碼
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="醫師提供的 6 碼代碼"
                maxLength={8}
              />
            </label>
            <label>
              您的姓名
              <input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="例如：王小明"
              />
            </label>
            <button className="primary" onClick={handleJoin} disabled={busy}>
              加入診間
            </button>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  )
}
