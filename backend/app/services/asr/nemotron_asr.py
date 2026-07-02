"""Real streaming ASR backed by nvidia/nemotron-3.5-asr-streaming-0.6b.

IMPORTANT / please read before relying on this module
-------------------------------------------------------
This adapter is written against NeMo's standard cache-aware streaming
Conformer/FastConformer API (the pattern used by NVIDIA's other streaming
ASR releases, e.g. `stt_en_fastconformer_hybrid_large_streaming_multi` and
the reference script
`examples/asr/asr_cache_aware_streaming/speech_to_text_cache_aware_streaming_infer.py`
in the NeMo repo). At the time this file was written, the model card for
nvidia/nemotron-3.5-asr-streaming-0.6b on huggingface.co could not be
fetched from this environment (outbound access to huggingface.co is blocked
by the sandbox's network egress policy), so the exact chunking parameters,
class name and expected `from_pretrained` call for THIS specific checkpoint
could not be verified against its documentation.

Before running this in production:
  1. Read the model card at
     https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
     and confirm the loading call, expected chunk size (`att_context_size`)
     and left/right context match what's used below.
  2. `pip install -r requirements-asr.txt` (torch + nemo_toolkit[asr]).
  3. Set ASR_BACKEND=nemotron and ASR_DEVICE=cuda (or cpu) in `.env`.
  4. A CUDA GPU is strongly recommended; CPU streaming inference will not
     keep up with real-time audio for most hardware.

If anything below doesn't match the installed nemo_toolkit version's API,
adjust `_load_model` / `_step` accordingly -- the rest of the app only
depends on the StreamingASREngine/StreamingASRSession interface in
`base.py`, so this file can be modified freely without touching anything
else.
"""

import asyncio
import logging

import numpy as np

from app.services.asr.base import StreamingASREngine, StreamingASRSession, TranscriptEvent

logger = logging.getLogger(__name__)

MODEL_NAME_DEFAULT = "nvidia/nemotron-3.5-asr-streaming-0.6b"


class NemotronStreamingASRSession(StreamingASRSession):
    """One streaming decode state, matching NeMo's cache-aware streaming API."""

    def __init__(self, model, device: str, sample_rate: int = 16000) -> None:
        import torch  # local import: optional heavy dependency

        self._torch = torch
        self.model = model
        self.device = device
        self.sample_rate = sample_rate

        streaming_cfg = model.encoder.streaming_cfg
        # chunk_size is expressed in encoder frames; pre_encode_cache_size in
        # raw audio samples both come from the model's own streaming config.
        self._chunk_samples = int(
            getattr(streaming_cfg, "shift_size_samples", None)
            or sample_rate // 10  # fallback: 100ms chunks
        )

        self._pcm_buffer = np.zeros((0,), dtype=np.float32)

        cache = model.encoder.get_initial_cache_state(batch_size=1)
        self._cache_last_channel, self._cache_last_time, self._cache_last_channel_len = cache
        self._previous_hypotheses = None
        self._pred_out_stream = None
        self._transcribed_so_far = ""
        self._elapsed_ms = 0

    def _pcm16_to_float32(self, pcm16_bytes: bytes) -> np.ndarray:
        int16 = np.frombuffer(pcm16_bytes, dtype=np.int16)
        return (int16.astype(np.float32)) / 32768.0

    async def push_audio(self, pcm16_bytes: bytes) -> list[TranscriptEvent]:
        if not pcm16_bytes:
            return []
        samples = self._pcm16_to_float32(pcm16_bytes)
        self._pcm_buffer = np.concatenate([self._pcm_buffer, samples])

        events: list[TranscriptEvent] = []
        while len(self._pcm_buffer) >= self._chunk_samples:
            chunk = self._pcm_buffer[: self._chunk_samples]
            self._pcm_buffer = self._pcm_buffer[self._chunk_samples :]
            text = await asyncio.to_thread(self._step, chunk, is_last=False)
            start_ms = self._elapsed_ms
            self._elapsed_ms += int(len(chunk) / self.sample_rate * 1000)
            if text is not None:
                events.append(
                    TranscriptEvent(text=text, is_final=False, start_ms=start_ms, end_ms=self._elapsed_ms)
                )
        return events

    def _step(self, chunk: np.ndarray, is_last: bool) -> str | None:
        torch = self._torch
        try:
            audio_signal = torch.tensor(chunk, dtype=torch.float32, device=self.device).unsqueeze(0)
            audio_signal_len = torch.tensor([chunk.shape[0]], device=self.device)

            processed_signal, processed_signal_length = self.model.preprocessor(
                input_signal=audio_signal, length=audio_signal_len
            )

            with torch.no_grad():
                (
                    self._pred_out_stream,
                    transcribed_texts,
                    self._cache_last_channel,
                    self._cache_last_time,
                    self._cache_last_channel_len,
                    self._previous_hypotheses,
                ) = self.model.conformer_stream_step(
                    processed_signal=processed_signal,
                    processed_signal_length=processed_signal_length,
                    cache_last_channel=self._cache_last_channel,
                    cache_last_time=self._cache_last_time,
                    cache_last_channel_len=self._cache_last_channel_len,
                    keep_all_outputs=is_last,
                    previous_hypotheses=self._previous_hypotheses,
                    previous_pred_out=self._pred_out_stream,
                    return_transcription=True,
                )

            if transcribed_texts:
                text = transcribed_texts[0].text if hasattr(transcribed_texts[0], "text") else str(
                    transcribed_texts[0]
                )
                if text and text != self._transcribed_so_far:
                    self._transcribed_so_far = text
                    return text
            return None
        except Exception:
            logger.exception("Nemotron streaming step failed; check NeMo API compatibility (see module docstring)")
            return None

    async def finalize(self) -> list[TranscriptEvent]:
        events: list[TranscriptEvent] = []
        if len(self._pcm_buffer) > 0:
            pad = self._chunk_samples - len(self._pcm_buffer)
            padded = np.concatenate([self._pcm_buffer, np.zeros(max(pad, 0), dtype=np.float32)])
            text = await asyncio.to_thread(self._step, padded, is_last=True)
            self._elapsed_ms += int(len(self._pcm_buffer) / self.sample_rate * 1000)
            self._pcm_buffer = np.zeros((0,), dtype=np.float32)
            if text:
                events.append(
                    TranscriptEvent(text=text, is_final=True, start_ms=0, end_ms=self._elapsed_ms)
                )
        elif self._transcribed_so_far:
            events.append(
                TranscriptEvent(
                    text=self._transcribed_so_far, is_final=True, start_ms=0, end_ms=self._elapsed_ms
                )
            )
        return events


class NemotronStreamingASREngine(StreamingASREngine):
    def __init__(self, model_name: str = MODEL_NAME_DEFAULT, device: str = "cuda", sample_rate: int = 16000) -> None:
        self.model_name = model_name
        self.device = device
        self.sample_rate = sample_rate
        self._model = None

    def _load_model(self):
        import torch
        import nemo.collections.asr as nemo_asr  # type: ignore

        device = self.device if torch.cuda.is_available() else "cpu"
        if device != self.device:
            logger.warning("CUDA not available; falling back to CPU for %s", self.model_name)

        model = nemo_asr.models.ASRModel.from_pretrained(model_name=self.model_name, map_location=device)
        model.eval()
        model = model.to(device)
        self.device = device
        return model

    async def warmup(self) -> None:
        if self._model is None:
            self._model = await asyncio.to_thread(self._load_model)

    def open_session(self) -> StreamingASRSession:
        if self._model is None:
            raise RuntimeError(
                "Nemotron ASR model not loaded yet. Call `await engine.warmup()` during app "
                "startup before opening sessions (see app/main.py lifespan)."
            )
        return NemotronStreamingASRSession(self._model, device=self.device, sample_rate=self.sample_rate)
