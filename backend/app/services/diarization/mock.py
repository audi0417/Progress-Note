"""Dependency-free diarizer used for dev/demo. It does NOT analyse voices;
it simulates a two-speaker back-and-forth by switching cluster whenever a new
finalized segment starts after a pause, so the rest of the pipeline (live A/B
labels → LLM role mapping → relabel) can be exercised without a GPU or model.
"""

from app.services.diarization.base import DiarizationEngine, StreamingDiarizer

_TURN_GAP_MS = 400  # a pause longer than this is treated as a speaker change


class MockStreamingDiarizer(StreamingDiarizer):
    def __init__(self, max_speakers: int = 2, sample_rate: int = 16000) -> None:
        self.max_speakers = max(1, max_speakers)
        self.sample_rate = sample_rate
        self._speaker_index = 0
        self._last_end_ms: int | None = None
        self._started = False

    async def push_audio(self, pcm16_bytes: bytes) -> None:
        # The mock derives everything from the ASR segment timings passed to
        # assign(), so there is nothing to accumulate here.
        return None

    async def assign(self, start_ms: int, end_ms: int) -> str | None:
        if not self._started:
            self._started = True
            self._speaker_index = 0
        elif self._last_end_ms is not None and start_ms - self._last_end_ms >= _TURN_GAP_MS:
            self._speaker_index = (self._speaker_index + 1) % self.max_speakers
        self._last_end_ms = end_ms
        return f"speaker_{self._speaker_index}"


class MockDiarizationEngine(DiarizationEngine):
    def __init__(self, max_speakers: int = 2, sample_rate: int = 16000) -> None:
        self.max_speakers = max_speakers
        self.sample_rate = sample_rate

    def open_session(self) -> StreamingDiarizer:
        return MockStreamingDiarizer(max_speakers=self.max_speakers, sample_rate=self.sample_rate)
