"""Real speaker diarization backed by NVIDIA NeMo (Sortformer).

IMPORTANT / please read before relying on this module
-------------------------------------------------------
Like ``services/asr/nemotron_asr.py``, this adapter is written against NeMo's
diarization API *from documentation knowledge*, not verified against a live
model — huggingface.co / NGC are blocked from the build environment, so the
exact class name, ``from_pretrained`` target and streaming API for the chosen
checkpoint could not be confirmed.

Design notes / simplifications made here (revisit before production):
  * NeMo's *streaming* Sortformer has a dedicated incremental API. To keep this
    adapter small and backend-agnostic, it instead buffers the audio and runs
    diarization over the running buffer, then answers ``assign()`` by picking
    the cluster with the most time overlap in the requested window. That is
    simpler but recomputes over a growing buffer — fine for short consultations,
    but a real deployment should use the true streaming API and/or a final
    re-diarization pass in ``finalize()``.
  * Diarization yields anonymous clusters only; mapping speaker_0/1 → doctor /
    patient is done later by the LLM (services/analysis_service.py).

Before running in production:
  1. Read the model card for the diarization checkpoint and confirm the load
     call + output format.
  2. ``pip install -r requirements-asr.txt`` (torch + nemo_toolkit[asr]).
  3. Set ``DIARIZATION_BACKEND=sortformer`` (and DIARIZATION_DEVICE) in .env.
  4. Adjust ``_load_model`` / ``_run_diarization`` to match the installed
     NeMo version's API. Nothing else in the app depends on the internals —
     only the StreamingDiarizer interface in base.py.
"""

import asyncio
import logging

import numpy as np

from app.services.diarization.base import DiarizationEngine, StreamingDiarizer

logger = logging.getLogger(__name__)

MODEL_NAME_DEFAULT = "nvidia/diar_streaming_sortformer_4spk-v2"


class SortformerStreamingDiarizer(StreamingDiarizer):
    def __init__(self, model, device: str, max_speakers: int = 2, sample_rate: int = 16000) -> None:
        self.model = model
        self.device = device
        self.max_speakers = max_speakers
        self.sample_rate = sample_rate
        self._pcm = np.zeros((0,), dtype=np.float32)
        # Diarization timeline: list of (label, start_ms, end_ms).
        self._timeline: list[tuple[str, int, int]] = []

    async def push_audio(self, pcm16_bytes: bytes) -> None:
        if not pcm16_bytes:
            return
        samples = np.frombuffer(pcm16_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self._pcm = np.concatenate([self._pcm, samples])

    def _run_diarization(self) -> list[tuple[str, int, int]]:
        """Run the model over the current buffer, returning (label, start_ms, end_ms).

        The exact call depends on the installed NeMo version; adapt as needed.
        """
        try:
            # Placeholder for the NeMo diarization call. A typical Sortformer
            # inference returns per-frame speaker activity probabilities that
            # are post-processed into segments. Replace with the real API.
            segments = self.model.diarize(  # type: ignore[attr-defined]
                audio=self._pcm,
                sample_rate=self.sample_rate,
                max_speakers=self.max_speakers,
            )
            timeline: list[tuple[str, int, int]] = []
            for seg in segments:
                timeline.append(
                    (f"speaker_{int(seg['speaker'])}", int(seg["start"] * 1000), int(seg["end"] * 1000))
                )
            return timeline
        except Exception:
            logger.exception("Sortformer diarization failed; verify NeMo API (see module docstring)")
            return self._timeline

    async def assign(self, start_ms: int, end_ms: int) -> str | None:
        self._timeline = await asyncio.to_thread(self._run_diarization)
        best_label: str | None = None
        best_overlap = 0
        for label, seg_start, seg_end in self._timeline:
            overlap = max(0, min(end_ms, seg_end) - max(start_ms, seg_start))
            if overlap > best_overlap:
                best_overlap = overlap
                best_label = label
        return best_label


class SortformerDiarizationEngine(DiarizationEngine):
    def __init__(
        self, model_name: str = MODEL_NAME_DEFAULT, device: str = "cuda", max_speakers: int = 2, sample_rate: int = 16000
    ) -> None:
        self.model_name = model_name
        self.device = device
        self.max_speakers = max_speakers
        self.sample_rate = sample_rate
        self._model = None

    def _load_model(self):
        import torch
        import nemo.collections.asr as nemo_asr  # type: ignore

        device = self.device if torch.cuda.is_available() else "cpu"
        model = nemo_asr.models.SortformerEncLabelModel.from_pretrained(  # type: ignore[attr-defined]
            model_name=self.model_name, map_location=device
        )
        model.eval()
        self.device = device
        return model

    async def warmup(self) -> None:
        if self._model is None:
            self._model = await asyncio.to_thread(self._load_model)

    def open_session(self) -> StreamingDiarizer:
        if self._model is None:
            raise RuntimeError("Diarization model not loaded; call await engine.warmup() at startup")
        return SortformerStreamingDiarizer(
            self._model, device=self.device, max_speakers=self.max_speakers, sample_rate=self.sample_rate
        )
