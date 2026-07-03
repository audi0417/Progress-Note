from functools import lru_cache

from app.config import get_settings
from app.services.diarization.base import DiarizationEngine, StreamingDiarizer
from app.services.diarization.mock import MockDiarizationEngine

__all__ = ["DiarizationEngine", "StreamingDiarizer", "get_diarization_engine"]


@lru_cache
def get_diarization_engine() -> DiarizationEngine:
    settings = get_settings()

    if settings.diarization_backend == "sortformer":
        from app.services.diarization.sortformer import SortformerDiarizationEngine

        return SortformerDiarizationEngine(
            model_name=settings.diarization_model_name,
            device=settings.diarization_device,
            max_speakers=settings.diarization_max_speakers,
            sample_rate=settings.asr_sample_rate,
        )

    return MockDiarizationEngine(
        max_speakers=settings.diarization_max_speakers, sample_rate=settings.asr_sample_rate
    )
