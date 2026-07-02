interface Props {
  isRecording: boolean
  disabled: boolean
  error: string | null
  onStart: () => void
  onStop: () => void
}

export function MicControl({ isRecording, disabled, error, onStart, onStop }: Props) {
  return (
    <div className="mic-control">
      <button
        className={`mic-button ${isRecording ? 'recording' : ''}`}
        disabled={disabled}
        onClick={isRecording ? onStop : onStart}
      >
        {isRecording ? '● 錄音中，點擊停止' : '🎙 開始語音辨識'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
