import { useCallback, useRef, useState } from 'react'

const TARGET_SAMPLE_RATE = 16000

/**
 * Captures microphone audio and streams it as raw PCM16LE mono frames at
 * TARGET_SAMPLE_RATE, matching what the backend ASR sessions expect
 * (see backend/app/services/asr/base.py).
 *
 * Uses a ScriptProcessorNode rather than an AudioWorklet: it's deprecated
 * but needs no separate worklet module file to load/build, keeps this hook
 * self-contained, and is still supported by every major browser.
 */
export function useAudioStreamer(onChunk: (chunk: ArrayBuffer) => void) {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const onChunkRef = useRef(onChunk)
  onChunkRef.current = onChunk

  const start = useCallback(async () => {
    if (isRecording) return
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(stream)
      sourceRef.current = source

      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      const silentGain = audioContext.createGain()
      silentGain.gain.value = 0

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        const pcm16 = downsampleToPCM16(input, audioContext.sampleRate, TARGET_SAMPLE_RATE)
        if (pcm16.byteLength > 0) {
          onChunkRef.current(pcm16)
        }
      }

      source.connect(processor)
      // Route through a muted gain node instead of straight to destination
      // so onaudioprocess keeps firing without producing mic feedback.
      processor.connect(silentGain)
      silentGain.connect(audioContext.destination)

      setIsRecording(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access microphone')
    }
  }, [isRecording])

  const stop = useCallback(() => {
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    audioContextRef.current?.close()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    processorRef.current = null
    sourceRef.current = null
    audioContextRef.current = null
    streamRef.current = null
    setIsRecording(false)
  }, [])

  return { isRecording, start, stop, error }
}

function downsampleToPCM16(input: Float32Array, inputSampleRate: number, targetSampleRate: number): ArrayBuffer {
  if (targetSampleRate >= inputSampleRate) {
    return floatTo16BitPCM(input)
  }
  const ratio = inputSampleRate / targetSampleRate
  const outputLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio
    const indexFloor = Math.floor(srcIndex)
    const indexCeil = Math.min(indexFloor + 1, input.length - 1)
    const frac = srcIndex - indexFloor
    output[i] = input[indexFloor] * (1 - frac) + input[indexCeil] * frac
  }

  return floatTo16BitPCM(output)
}

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
}
