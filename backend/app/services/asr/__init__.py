from functools import lru_cache

from app.config import get_settings
from app.services.asr.base import StreamingASREngine, StreamingASRSession, TranscriptEvent
from app.services.asr.mock_asr import MockStreamingASREngine

__all__ = [
    "StreamingASREngine",
    "StreamingASRSession",
    "TranscriptEvent",
    "get_asr_engine",
]


@lru_cache
def get_asr_engine() -> StreamingASREngine:
    settings = get_settings()

    if settings.asr_backend == "nemotron":
        from app.services.asr.nemotron_asr import NemotronStreamingASREngine

        return NemotronStreamingASREngine(
            model_name=settings.asr_model_name,
            device=settings.asr_device,
            sample_rate=settings.asr_sample_rate,
        )

    return MockStreamingASREngine(sample_rate=settings.asr_sample_rate)
