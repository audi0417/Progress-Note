"""A dependency-free ASR backend used for local development and demos.

It does NOT perform real speech recognition. Instead it runs a simple
energy-based voice-activity detector over the incoming PCM16 audio and emits
placeholder transcript events whenever it detects a "speech" segment ending.
This lets the rest of the stack (websocket streaming, live transcript panel,
doctor edits, finalize -> LLM analysis) be exercised end-to-end without a GPU
or the (large) Nemotron model weights.

Switch to the real model with ASR_BACKEND=nemotron once weights + a
CUDA GPU are available (see services/asr/nemotron_asr.py).
"""

import audioop
import time

from app.services.asr.base import StreamingASREngine, StreamingASRSession, TranscriptEvent

_SILENCE_RMS_THRESHOLD = 400  # empirical threshold for 16-bit PCM
_MIN_SPEECH_MS = 300
_SILENCE_HOLD_MS = 700


class MockStreamingASRSession(StreamingASRSession):
    def __init__(self, sample_rate: int = 16000) -> None:
        self.sample_rate = sample_rate
        self._speaking = False
        self._speech_started_at_ms: int | None = None
        self._silence_started_at_ms: int | None = None
        self._elapsed_ms = 0
        self._segment_count = 0
        self._emitted_partial = False

    def _bytes_to_ms(self, n_bytes: int) -> int:
        # 16-bit mono PCM -> 2 bytes/sample
        n_samples = n_bytes // 2
        return int(n_samples / self.sample_rate * 1000)

    async def push_audio(self, pcm16_bytes: bytes) -> list[TranscriptEvent]:
        if not pcm16_bytes:
            return []

        chunk_ms = self._bytes_to_ms(len(pcm16_bytes))
        start_ms = self._elapsed_ms
        self._elapsed_ms += chunk_ms

        rms = audioop.rms(pcm16_bytes, 2)
        events: list[TranscriptEvent] = []

        if rms >= _SILENCE_RMS_THRESHOLD:
            if not self._speaking:
                self._speaking = True
                self._speech_started_at_ms = start_ms
                self._emitted_partial = False
            self._silence_started_at_ms = None

            if not self._emitted_partial:
                events.append(
                    TranscriptEvent(
                        text="…（偵測到語音，辨識中）",
                        is_final=False,
                        start_ms=self._speech_started_at_ms or start_ms,
                        end_ms=self._elapsed_ms,
                    )
                )
                self._emitted_partial = True
        else:
            if self._speaking:
                if self._silence_started_at_ms is None:
                    self._silence_started_at_ms = start_ms
                elif start_ms - self._silence_started_at_ms >= _SILENCE_HOLD_MS:
                    events.extend(self._flush_segment())

        return events

    def _flush_segment(self) -> list[TranscriptEvent]:
        if not self._speaking or self._speech_started_at_ms is None:
            return []

        speech_start = self._speech_started_at_ms
        speech_end = self._elapsed_ms
        duration_ms = speech_end - speech_start

        self._speaking = False
        self._speech_started_at_ms = None
        self._silence_started_at_ms = None

        if duration_ms < _MIN_SPEECH_MS:
            return []

        self._segment_count += 1
        placeholder = (
            f"[模擬語音辨識 #{self._segment_count}：偵測到約 {duration_ms / 1000:.1f} 秒語音，"
            "請於此手動輸入/校對實際內容，或設定 ASR_BACKEND=nemotron 以啟用真實模型]"
        )
        return [
            TranscriptEvent(
                text=placeholder,
                is_final=True,
                start_ms=speech_start,
                end_ms=speech_end,
            )
        ]

    async def finalize(self) -> list[TranscriptEvent]:
        return self._flush_segment()


class MockStreamingASREngine(StreamingASREngine):
    def __init__(self, sample_rate: int = 16000) -> None:
        self.sample_rate = sample_rate

    def open_session(self) -> StreamingASRSession:
        return MockStreamingASRSession(sample_rate=self.sample_rate)

    async def warmup(self) -> None:
        # nothing to load
        time.sleep(0)
