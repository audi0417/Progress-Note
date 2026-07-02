import type { ConsultationSession, SpeakerRole } from '../types'

interface Props {
  session: ConsultationSession
  role: SpeakerRole
  wsStatus: 'connecting' | 'open' | 'closed'
  demo?: boolean
  onLeave: () => void
}

const statusLabel: Record<Props['wsStatus'], string> = {
  connecting: '連線中…',
  open: '已連線',
  closed: '連線中斷',
}

export function RoleBanner({ session, role, wsStatus, demo = false, onLeave }: Props) {
  return (
    <div className="role-banner">
      <div>
        <span className={`role-pill ${role}`}>{role === 'doctor' ? '醫師視角' : '病患視角'}</span>
        <span className="session-meta">
          {session.doctor_name} {session.patient_name ? `× ${session.patient_name}` : ''}
        </span>
      </div>
      <div className="role-banner-right">
        {role === 'doctor' && (
          <span className="join-code">
            診間代碼：<strong>{session.join_code}</strong>
          </span>
        )}
        {demo ? (
          <span className="ws-status demo">Demo · 單機模式</span>
        ) : (
          <span className={`ws-status ${wsStatus}`}>{statusLabel[wsStatus]}</span>
        )}
        <button className="ghost leave-button" onClick={onLeave}>
          離開診間
        </button>
      </div>
    </div>
  )
}
