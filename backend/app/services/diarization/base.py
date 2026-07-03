from abc import ABC, abstractmethod


class StreamingDiarizer(ABC):
    """Tracks "who is speaking when" over a single audio stream that may
    contain several people (e.g. the doctor's phone capturing the whole room).

    The same PCM16 audio fed to the ASR session is also fed here. When the ASR
    finalizes a text segment spanning [start_ms, end_ms], the websocket handler
    calls :meth:`assign` to get the dominant speaker cluster for that window.

    Clusters are anonymous ("speaker_0", "speaker_1", ...) — diarization does
    NOT know which cluster is the doctor vs the patient. That mapping is done
    later by the LLM (see services/analysis_service.py).
    """

    sample_rate: int = 16000

    @abstractmethod
    async def push_audio(self, pcm16_bytes: bytes) -> None:
        """Feed raw PCM16LE mono audio to advance the diarization timeline."""

    @abstractmethod
    async def assign(self, start_ms: int, end_ms: int) -> str | None:
        """Return the dominant speaker cluster label for the given time window,
        or None if it cannot be determined."""

    async def finalize(self) -> None:
        """Optionally run a final (more accurate) re-diarization pass."""
        return None

    async def close(self) -> None:
        return None


class DiarizationEngine(ABC):
    """Factory for per-connection diarizer sessions, backed by one loaded model."""

    @abstractmethod
    def open_session(self) -> StreamingDiarizer:
        ...

    async def warmup(self) -> None:
        return None
