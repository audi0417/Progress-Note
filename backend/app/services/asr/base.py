from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class TranscriptEvent:
    """A piece of transcription output produced by an ASR streaming session.

    is_final=False events are low-latency partial hypotheses that should be
    shown to the user but may still change; is_final=True events are stable
    and get persisted as a TranscriptSegment.
    """

    text: str
    is_final: bool
    start_ms: int
    end_ms: int


class StreamingASRSession(ABC):
    """One streaming ASR session, bound to a single speaker/connection.

    Audio is pushed in as it arrives from the browser (PCM16 mono, see
    ``sample_rate``); the implementation is responsible for any internal
    buffering / chunking the underlying model needs.
    """

    sample_rate: int = 16000

    @abstractmethod
    async def push_audio(self, pcm16_bytes: bytes) -> list[TranscriptEvent]:
        """Feed raw PCM16LE mono audio, return any new transcript events."""

    @abstractmethod
    async def finalize(self) -> list[TranscriptEvent]:
        """Flush any buffered audio and return final transcript event(s)."""

    async def close(self) -> None:
        """Release any resources held by this session (no-op by default)."""
        return None


class StreamingASREngine(ABC):
    """Factory for per-connection streaming sessions, backed by one loaded model."""

    @abstractmethod
    def open_session(self) -> StreamingASRSession:
        """Create a new streaming session (call once per websocket connection)."""

    async def warmup(self) -> None:
        """Optionally load/compile the model eagerly at app startup."""
        return None
