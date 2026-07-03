"""Turns a finished consultation transcript into a structured clinical note:
a clinician-facing diagnosis/plan and a plain-language patient summary with
medications, follow-up steps and warning signs.

It also maps the anonymous diarization clusters (speaker_0 / speaker_1) to
doctor / patient roles — diarization knows *that* two people spoke, this step
decides *who is who* from what they said.

Uses the Anthropic API by default (ANTHROPIC_API_KEY). If no API key is
configured, falls back to a deterministic offline summarizer + heuristic role
mapping so the rest of the app can be exercised without network / credentials.
"""

import json
import logging

from app.config import get_settings
from app.models import SpeakerRole, TranscriptSegment

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是一位協助醫師整理病歷的臨床文書助理。
你會收到一段門診/診間對話的逐字稿。逐字稿是由單一麥克風收音後自動分離出的匿名說話者，
每一句前面標了 speaker_0、speaker_1 等匿名標記——這些標記代表「不同的人」，但尚未知道誰是醫師、誰是病患。

請完成兩件事，並只輸出一個 JSON 物件（不要有其他文字或 Markdown）：

1. speaker_roles: 一個物件，把每個出現過的匿名標記對應到 "doctor" 或 "patient"。
   例如 {"speaker_0": "doctor", "speaker_1": "patient"}。判斷依據：問診斷、開藥、給建議的通常是醫師；
   描述症狀、回答問題的通常是病患。

2. 依對話內容整理下列欄位：
- diagnosis_summary: 給醫師看的臨床摘要與初步診斷（專業用語，精簡條列可用換行）。
- treatment_plan: 給醫師看的處置計畫。
- patient_summary: 給病患看的白話說明，解釋這次看診發生的事、目前的狀況，避免艱澀醫學術語。
- medications: 陣列，每項為 {"name": 藥名, "dosage": 劑量, "instructions": 服用方式/注意事項}；若無用藥回傳空陣列。
- follow_up: 給病患看的後續追蹤建議。
- warning_signs: 給病患看的警訊說明，什麼情況需要立即就醫。

若逐字稿內容不足以判斷某欄位，請依現有資訊合理歸納，並在該欄位註明「此摘要僅供參考，實際診斷請以醫師最終確認為準」。
"""

_ROLE_VALUES = {"doctor", "patient"}


def _seg_text(seg: TranscriptSegment) -> str:
    return (seg.edited_text if seg.edited_text is not None else seg.original_text).strip()


def _seg_tag(seg: TranscriptSegment) -> str:
    """How a segment is labelled in the transcript sent to the LLM."""
    if seg.speaker == SpeakerRole.DOCTOR:
        return "醫師"
    if seg.speaker == SpeakerRole.PATIENT:
        return "病患"
    return seg.speaker_label or "speaker_?"


def _build_transcript_text(segments: list[TranscriptSegment]) -> str:
    lines = []
    for seg in sorted(segments, key=lambda s: s.sequence):
        text = _seg_text(seg)
        if text:
            lines.append(f"{_seg_tag(seg)}：{text}")
    return "\n".join(lines)


def heuristic_speaker_roles(segments: list[TranscriptSegment]) -> dict[str, str]:
    """Offline fallback: assume the first person to speak is the doctor
    (they usually open the consultation), everyone else is the patient."""
    roles: dict[str, str] = {}
    for seg in sorted(segments, key=lambda s: s.sequence):
        label = seg.speaker_label
        if not label or label in roles:
            continue
        roles[label] = "doctor" if not roles else "patient"
    return roles


def _fallback_analysis(transcript_text: str) -> dict:
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


def _clean_speaker_roles(raw: object) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {str(k): v for k, v in raw.items() if v in _ROLE_VALUES}


async def analyze_transcript(segments: list[TranscriptSegment]) -> dict:
    """Returns a dict with the ClinicalNote fields plus:
      - "speaker_roles": {diarization_label: "doctor"|"patient"}
      - "raw": the unparsed LLM response (audit)
    """
    transcript_text = _build_transcript_text(segments)
    settings = get_settings()

    if not settings.anthropic_api_key:
        logger.warning("ANTHROPIC_API_KEY not set; using offline fallback analysis + heuristic roles")
        result = _fallback_analysis(transcript_text)
        return {**result, "speaker_roles": heuristic_speaker_roles(segments), "raw": result}

    try:
        result = await _analyze_with_anthropic(transcript_text, settings)
        # If the model didn't return a usable mapping, fall back to the heuristic.
        if not result.get("speaker_roles"):
            result["speaker_roles"] = heuristic_speaker_roles(segments)
        return result
    except Exception:
        logger.exception("LLM analysis failed; falling back to offline summary")
        result = _fallback_analysis(transcript_text)
        return {**result, "speaker_roles": heuristic_speaker_roles(segments), "raw": {"error": "llm_call_failed"}}


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
    parsed["speaker_roles"] = _clean_speaker_roles(parsed.get("speaker_roles"))

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
