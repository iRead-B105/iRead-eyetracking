from __future__ import annotations

from typing import Any


VALID_CONTENT_TYPES = {"TEST", "TRAINING", "STORY"}


def build_session_start_request(payload: dict[str, Any]) -> dict[str, Any]:
    student_id = required_int(payload.get("studentId"), "studentId")
    content_type = str(payload.get("contentType") or "TEST").upper()
    content_id = required_int(payload.get("contentId"), "contentId")
    if content_type not in VALID_CONTENT_TYPES:
        raise ValueError(f"Unsupported contentType: {content_type}")

    request: dict[str, Any] = {
        "studentId": student_id,
        "contentType": content_type,
        "calibrationStatus": str(payload.get("calibrationStatus") or "SUCCESS").upper(),
    }
    id_field = {
        "TEST": "testId",
        "TRAINING": "trainingId",
        "STORY": "storyId",
    }[content_type]
    request[id_field] = content_id
    return request


def build_analysis_results_request(payload: dict[str, Any]) -> dict[str, Any]:
    student_id = required_int(payload.get("studentId"), "studentId")
    summary = as_dict(payload.get("summary"))
    words = as_list(payload.get("words"))

    total_visited_duration = summary_int(
        summary,
        "totalDwellMs",
        sum(safe_int(word.get("dwellMs")) for word in words if isinstance(word, dict)),
    )
    total_visited_count = summary_int(
        summary,
        "totalVisitCount",
        sum(safe_int(word.get("visitCount")) for word in words if isinstance(word, dict)),
    )
    reverse_read_count = summary_int(
        summary,
        "totalRegressionCount",
        sum(safe_int(word.get("regressionCount")) for word in words if isinstance(word, dict)),
    )
    visited_words = summary_int(
        summary,
        "visitedWords",
        sum(1 for word in words if isinstance(word, dict) and safe_int(word.get("visitCount")) > 0),
    )
    avg_visited_duration = round(total_visited_duration / visited_words) if visited_words > 0 else 0

    request: dict[str, Any] = {
        "studentId": student_id,
        "totalVisitedDuration": total_visited_duration,
        "totalVisitedCount": total_visited_count,
        "reverseReadCount": reverse_read_count,
        "avgVisitedDuration": avg_visited_duration,
    }
    sentence_metrics = payload.get("sentenceMetrics") or summary.get("sentenceMetrics")
    if isinstance(sentence_metrics, list):
        request["sentenceMetrics"] = sentence_metrics
    return request


def build_session_end_request(payload: dict[str, Any]) -> dict[str, Any]:
    request: dict[str, Any] = {
        "studentId": required_int(payload.get("studentId"), "studentId"),
        "endStatus": str(payload.get("endStatus") or payload.get("status") or "COMPLETED").upper(),
    }
    data = build_session_data(payload)
    if data:
        request["data"] = data
    return request


def build_word_attempts(words: list[Any]) -> list[dict[str, Any]]:
    attempts: list[dict[str, Any]] = []
    for word in words:
        if not isinstance(word, dict):
            continue
        dwell_ms = safe_int(word.get("dwellMs"))
        visit_count = safe_int(word.get("visitCount"))
        attempt: dict[str, Any] = {
            "wordIndex": safe_int(word.get("index")),
            "surfaceText": str(word.get("text") or ""),
            "hasGazeData": visit_count > 0,
            "fixationDurationMs": dwell_ms,
            "fixationCount": visit_count,
            "gazeStartOffsetMs": nullable_int(word.get("firstSeenOffsetMs") or word.get("firstSeenMs")),
            "gazeEndOffsetMs": nullable_int(word.get("lastSeenOffsetMs") or word.get("lastSeenMs")),
            "isSkipped": visit_count <= 0 or dwell_ms <= 0,
            "regressionCount": safe_int(word.get("regressionCount")),
        }
        for source_key, target_key in (
            ("wordId", "wordId"),
            ("storyLineId", "storyLineId"),
            ("hasAudioData", "hasAudioData"),
        ):
            if word.get(source_key) is not None:
                attempt[target_key] = word[source_key]
        attempts.append(attempt)
    return attempts


def build_backend_payload_preview(gaze_session_id: Any, payload: dict[str, Any]) -> dict[str, Any]:
    preview: dict[str, Any] = {
        "analysisResultsRequest": build_analysis_results_request(payload),
        "sessionEndRequest": build_session_end_request(payload),
        "wordAttempts": build_word_attempts(as_list(payload.get("words"))),
    }
    if gaze_session_id not in (None, ""):
        preview["gazeSessionId"] = safe_int(gaze_session_id)
    return preview


def build_session_data(payload: dict[str, Any]) -> dict[str, Any]:
    explicit = payload.get("data")
    if isinstance(explicit, dict):
        return explicit

    summary = as_dict(payload.get("summary"))
    metadata = as_dict(payload.get("metadata"))
    data: dict[str, Any] = {}
    filters = metadata.get("filters") or summary.get("filters") or payload.get("filters")
    if isinstance(filters, dict):
        data["filters"] = filters

    sample_summary: dict[str, int] = {}
    for key in (
        "validSampleCount",
        "invalidSampleCount",
        "outlierSampleCount",
        "blinkCooldownCount",
        "headPoseRejectedCount",
    ):
        if summary.get(key) is not None:
            sample_summary[key] = safe_int(summary.get(key))
    if sample_summary:
        data["sampleSummary"] = sample_summary

    if summary.get("readingTimeMs") is not None:
        data["readingTimeMs"] = safe_int(summary.get("readingTimeMs"))
    if summary.get("samplingHz") is not None:
        data["samplingHz"] = safe_int(summary.get("samplingHz"))
    # 백엔드 hasCompletedData는 data.samples/words를 요구한다.
    # explicit data에 없으면 payload 최상위 words/samples로 채운다.
    if "words" not in data:
        words = as_list(payload.get("words"))
        if words:
            data["words"] = words
    if "samples" not in data:
        samples = payload.get("samples")
        if isinstance(samples, list):
            data["samples"] = samples
    return data


def required_int(value: Any, field: str) -> int:
    if value in (None, ""):
        raise ValueError(f"{field} is required for backend gaze sync.")
    return int(value)


def safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def nullable_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    return safe_int(value)


def summary_int(summary: dict[str, Any], key: str, fallback: int) -> int:
    value = summary.get(key)
    return safe_int(value) if value is not None else int(fallback)


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []
