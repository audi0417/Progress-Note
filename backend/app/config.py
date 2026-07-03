from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Progress Note"
    database_url: str = "sqlite+aiosqlite:///./progress_note.db"

    # ASR backend: "mock" (no GPU/weights needed, good for dev/demo) or
    # "nemotron" (real nvidia/nemotron-3.5-asr-streaming-0.6b via NeMo).
    asr_backend: str = "mock"
    asr_model_name: str = "nvidia/nemotron-3.5-asr-streaming-0.6b"
    asr_sample_rate: int = 16000
    asr_device: str = "cuda"

    # Speaker diarization ("who spoke when"). "mock" simulates a two-speaker
    # back-and-forth without any model; "sortformer" uses NVIDIA NeMo streaming
    # diarization (GPU). Diarization only produces anonymous clusters
    # (speaker_0/1); mapping clusters to doctor/patient happens via the LLM at
    # the end of the consultation.
    diarization_backend: str = "mock"
    diarization_model_name: str = "nvidia/diar_streaming_sortformer_4spk-v2"
    diarization_device: str = "cuda"
    diarization_max_speakers: int = 2

    # LLM analysis backend used to turn a raw transcript into a structured,
    # patient-friendly clinical note once a consultation ends.
    llm_provider: str = "anthropic"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-5"

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
