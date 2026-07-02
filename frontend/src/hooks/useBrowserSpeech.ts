import { useCallback, useEffect, useRef, useState } from 'react'

// Minimal typings for the Web Speech API (not in the standard DOM lib).
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): { transcript: string }
  [index: number]: { transcript: string }
}
interface SpeechRecognitionEvent {
  readonly resultIndex: number
  readonly results: {
    readonly length: number
    item(index: number): SpeechRecognitionResult
    [index: number]: SpeechRecognitionResult
  }
}
interface SpeechRecognitionErrorEvent {
  readonly error: string
}
interface SpeechRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognition

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

interface Options {
  lang?: string
  onPartial: (text: string) => void
  onFinal: (text: string) => void
}

/**
 * Real speech-to-text using the browser's built-in Web Speech API, used in
 * DEMO_MODE so the app works on GitHub Pages with no backend. Works best on
 * Chrome / Android; iOS Safari support is limited and inconsistent, so callers
 * should keep a manual text-entry fallback for unsupported browsers.
 */
export function useBrowserSpeech({ lang = 'zh-TW', onPartial, onFinal }: Options) {
  const supported = getRecognitionCtor() !== null
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const shouldListenRef = useRef(false)
  const onPartialRef = useRef(onPartial)
  const onFinalRef = useRef(onFinal)
  onPartialRef.current = onPartial
  onFinalRef.current = onFinal

  const ensureRecognition = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current
    const Ctor = getRecognitionCtor()
    if (!Ctor) return null

    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          const finalText = transcript.trim()
          if (finalText) onFinalRef.current(finalText)
        } else {
          interim += transcript
        }
      }
      onPartialRef.current(interim.trim())
    }

    recognition.onerror = (event) => {
      // no-speech / aborted are transient; only surface real failures.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('無法使用麥克風，請允許瀏覽器的麥克風權限')
        shouldListenRef.current = false
        setIsListening(false)
      } else if (event.error === 'audio-capture') {
        setError('找不到麥克風裝置')
        shouldListenRef.current = false
        setIsListening(false)
      }
    }

    recognition.onend = () => {
      // Chrome ends the session after a pause; restart while still recording.
      if (shouldListenRef.current) {
        try {
          recognition.start()
        } catch {
          /* start() throws if already started; safe to ignore */
        }
      } else {
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition
    return recognition
  }, [lang])

  const start = useCallback(() => {
    setError(null)
    const recognition = ensureRecognition()
    if (!recognition) {
      setError('此瀏覽器不支援語音辨識，請改用手動輸入')
      return
    }
    shouldListenRef.current = true
    try {
      recognition.start()
      setIsListening(true)
    } catch {
      // Already started — treat as listening.
      setIsListening(true)
    }
  }, [ensureRecognition])

  const stop = useCallback(() => {
    shouldListenRef.current = false
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  useEffect(() => {
    return () => {
      shouldListenRef.current = false
      recognitionRef.current?.abort()
    }
  }, [])

  return { supported, isListening, start, stop, error }
}
