"""Turns a finished consultation transcript into a structured clinical note:
a clinician-facing diagnosis/plan and a plain-language patient summary with
medications, follow-up steps and warning signs.

Uses the Anthropic API by default (ANTHROPIC_API_KEY). If no API key is
configured, falls back to a deterministic offline summarizer so the rest of
the app (review UI, patient view) can still be exercised without network
access or credentials.
"""

import json
import logging

from app.config import get_settings
from app.models import SpeakerRole, TranscriptSegment

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是一位協助醫師整理病歷的臨床文書助理。
你會收到一段門診/診間對話的逐字稿（含醫師與病患發言）。
請將內容整理成結構化 JSON，且只能輸出 JSON，不要有其他文字或 Markdown 標記。

JSON 欄位：
- diagnosis_summary: 給醫師看的臨床摘要與初步診斷（專業用語，精簡條列可用換行）。
- treatment_plan: 給醫師看的處置計畫。
- patient_summary: 給病患看的白話說明，解釋這次看診發生的事、目前的狀況，避免艱澀醫學術語。
- medications: 陣列，每項為 {"name": 藥名, "dosage": 劑量, "instructions": 服用方式/注意事項}；若對話中沒有提到用藥，回傳空陣列。
- follow_up: 給病患看的後續追蹤建議（例如回診時間、需要做的檢查、生活注意事項）。
- warning_signs: 給病患看的警訊說明，什麼情況需要立即就醫或聯絡醫療院所。

若逐字稿內容不足以判斷某欄位，請依現有資訊合理歸納，並在該欄位註明「此摘要僅供參考，實際診斷請以醫師最終確認為準」。
"""


def _build_transcript_text(segments: list[TranscriptSegment]) -> str:
    lines = []
    for seg in sorted(segments, key=lambda s: s.sequence):
        speaker = "醫師" if seg.speaker == SpeakerRole.DOCTOR else "病患"
        text = seg.edited_text if seg.edited_text is not None else seg.original_text
        if text.strip():
            lines.append(f"{speaker}：{text.strip()}")
    return "\n".join(lines)


def _fallback_analysis(transcript_text: str) -> dict:
    """Deterministic, offline stand-in used when no LLM credentials are configured."""
    snippet = transcript_text[:800] or "（本次對話沒有擷取到逐字稿內容）"
    return {
        "diagnosis_summary": (
            "【離線模式，未設定 LLM API 金鑰，以下為原始逐字稿摘錄，非 AI 生成摘要】\n" + snippet
        ),
        "treatment_plan": "請醫師參考逐字稿內容手動填寫處置計畫，或設定 ANTHROPIC_API_KEY 以啟用自動分析。",
        "patient_summary": "本次看診紀錄尚未經過 AI 整理，請醫師協助手動說明本次看診重點。",
        "medications": [],
        "follow_up": "請依醫師指示安排回診或後續追蹤。",
        "warning_signs": "如症狀惡化或出現不適，請儘速回診或聯絡醫療院所。",
    }


async def analyze_transcript(segments: list[TranscriptSegment]) -> dict:
    """Returns a dict matching the fields consumed by app.models.ClinicalNote,
    plus a "raw" key holding the unparsed LLM response for audit purposes."""

    transcript_text = _build_transcript_text(segments)
    settings = get_settings()

    if not settings.anthropic_api_key:
        logger.warning("ANTHROPIC_API_KEY not set; using offline fallback analysis")
        result = _fallback_analysis(transcript_text)
        return {**result, "raw": result}

    try:
        result = await _analyze_with_anthropic(transcript_text, settings)
        return result
    except Exception:
        logger.exception("LLM analysis failed; falling back to offline summary")
        result = _fallback_analysis(transcript_text)
        return {**result, "raw": {"error": "llm_call_failed", "fallback": result}}


async def _analyze_with_anthropic(transcript_text: str, settings) -> dict:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    response = await client.messages.create(
        model=settings.anthropic_model,
        max_tokens=2000,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"以下是本次診間對話逐字稿：\n\n{transcript_text or '（無內容）'}",
            }
        ],
    )

    text_blocks = [block.text for block in response.content if getattr(block, "type", None) == "text"]
    raw_text = "\n".join(text_blocks).strip()

    parsed = _extract_json(raw_text)
    parsed.setdefault("medications", [])
    for key in ("diagnosis_summary", "treatment_plan", "patient_summary", "follow_up", "warning_signs"):
        parsed.setdefault(key, "")

    return {**parsed, "raw": {"text": raw_text}}


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("LLM response did not contain a JSON object")
    return json.loads(text[start : end + 1])
