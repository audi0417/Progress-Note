import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerEvent, SpeakerRole } from '../types'

type ConnectionStatus = 'connecting' | 'open' | 'closed'

interface Options {
  sessionId: string | null
  role: SpeakerRole
  name: string
  onEvent: (event: ServerEvent) => void
  /** Set to false once the consultation has ended, to stop reconnect attempts. */
  enabled: boolean
}

export function useConsultationSocket({ sessionId, role, name, onEvent, enabled }: Options) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const socketRef = useRef<WebSocket | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!sessionId || !enabled) return

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${protocol}://${window.location.host}/ws/consultation/${sessionId}?role=${role}&name=${encodeURIComponent(
      name,
    )}`
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket
    setStatus('connecting')

    socket.onopen = () => setStatus('open')
    socket.onclose = () => setStatus('closed')
    socket.onerror = () => setStatus('closed')
    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as ServerEvent
        onEventRef.current(parsed)
      } catch {
        // ignore malformed messages
      }
    }

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [sessionId, role, name, enabled])

  const sendAudio = useCallback((chunk: ArrayBuffer) => {
    const socket = socketRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(chunk)
    }
  }, [])

  return { status, sendAudio }
}
