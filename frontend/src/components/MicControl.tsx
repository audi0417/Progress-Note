interface Props {
  isRecording: boolean
  disabled: boolean
  error: string | null
  onStart: () => void
  onStop: () => void
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="9" y1="21" x2="15" y2="21" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

export function MicControl({ isRecording, disabled, error, onStart, onStop }: Props) {
  return (
    <div className="mic-control">
      <button
        className={`mic-orb ${isRecording ? 'recording' : ''}`}
        disabled={disabled}
        onClick={isRecording ? onStop : onStart}
        aria-label={isRecording ? '停止語音辨識' : '開始語音辨識'}
      >
        {isRecording ? <StopIcon /> : <MicIcon />}
      </button>
      <p className="mic-caption">{isRecording ? '錄音中，點擊停止' : '點擊開始語音辨識'}</p>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
