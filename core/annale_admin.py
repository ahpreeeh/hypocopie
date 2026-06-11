from __future__ import annotations

import base64
import copy
import os
import re
from typing import Any

from core.options import OPTION_LETTERS
from core.storage import safe_filename, safe_slug, utc_now_iso


VALID_QUESTION_TYPES = {"QRU", "QRM", "QROC", "ZONE"}
VALID_SERIES_FORMATS = {"DP", "KFP"}
IMAGE_HINT_RE = re.compile(
    r"\b(ecg|electrocardiogramme|figure|ci-dessous|scanner|irm|radio|radiographie|"
    r"imagerie|image|photo|sch[ée]ma)\b",
    re.IGNORECASE,
)


def clone_json(value: Any) -> Any:
    return copy.deepcopy(value)


def normalize_admin_question(raw: Any, existing_id: str | None = None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("question : objet JSON attendu")

    qid = str(raw.get("id") or existing_id or "").strip()
    if existing_id:
        qid = existing_id
    if not qid:
        raise ValueError("question.id manquant")

    qtype = str(raw.get("questionType") or "").strip().upper()
    if qtype not in VALID_QUESTION_TYPES:
        raise ValueError(f"questionType invalide : {qtype or '(vide)'}")

    text = str(raw.get("text") or "").strip()
    if not text:
        raise ValueError("text ne peut pas etre vide")

    q: dict[str, Any] = {
        "id": qid,
        "questionType": qtype,
        "text": text,
        "image": safe_filename(raw.get("image")) if raw.get("image") else None,
        "correctionText": _clean_optional(raw.get("correctionText"), 20000),
        "expectedAnswer": _clean_optional(raw.get("expectedAnswer"), 5000),
        "seriesId": _clean_optional(raw.get("seriesId"), 100),
        "seriesFormat": _clean_optional(raw.get("seriesFormat"), 10),
        "seriesPosition": _int_or_none(raw.get("seriesPosition")),
        "seriesTotal": _int_or_none(raw.get("seriesTotal")),
        "vignette": _clean_optional(raw.get("vignette"), 30000),
        "customTitle": _clean_optional(raw.get("customTitle"), 500),
    }

    if q["seriesFormat"] and q["seriesFormat"] not in VALID_SERIES_FORMATS:
        raise ValueError("seriesFormat invalide")
    if bool(q["seriesId"]) != bool(q["seriesFormat"]):
        raise ValueError("seriesId et seriesFormat doivent etre fournis ensemble")

    options = raw.get("options")
    if qtype in {"QRU", "QRM"}:
        if not isinstance(options, list) or not options:
            raise ValueError(f"{qtype}: options requises")
        if len(options) > len(OPTION_LETTERS):
            raise ValueError(f"options : maximum {len(OPTION_LETTERS)} propositions")
        q["options"] = _normalize_options(options)
        correct_count = sum(1 for opt in q["options"] if opt.get("correct"))
        if qtype == "QRU" and correct_count != 1:
            raise ValueError("QRU: exactement 1 bonne reponse requise")
        if qtype == "QRM" and correct_count < 1:
            raise ValueError("QRM: au moins 1 bonne reponse requise")
        q["expectedAnswer"] = None
    else:
        q["options"] = []

    source_refs = raw.get("sourceRefs")
    if isinstance(source_refs, list):
        q["sourceRefs"] = [str(item)[:500] for item in source_refs if item]

    warnings = raw.get("warnings")
    if isinstance(warnings, list):
        q["warnings"] = [w for w in warnings if isinstance(w, dict)]

    images = raw.get("images")
    if isinstance(images, list):
        q["images"] = [img for img in images if isinstance(img, dict)]

    return q


def make_blank_question(qid: str) -> dict[str, Any]:
    return {
        "id": qid,
        "questionType": "QRM",
        "text": "Nouvelle question",
        "image": None,
        "options": [
            {"id": "A", "text": "Proposition A", "correct": True},
            {"id": "B", "text": "Proposition B", "correct": False},
        ],
        "expectedAnswer": None,
        "correctionText": "",
        "seriesId": None,
        "seriesFormat": None,
        "seriesPosition": None,
        "seriesTotal": None,
        "vignette": None,
        "customTitle": None,
    }


def next_question_id(questions: list[dict[str, Any]]) -> str:
    used = {str(q.get("id")) for q in questions if isinstance(q, dict)}
    max_num = 0
    for qid in used:
        match = re.fullmatch(r"q(\d+)", qid)
        if match:
            max_num = max(max_num, int(match.group(1)))
    candidate = f"q{max_num + 1}"
    while candidate in used:
        max_num += 1
        candidate = f"q{max_num + 1}"
    return candidate


def normalize_series_metadata(annale: dict[str, Any]) -> None:
    questions = annale.get("questions") if isinstance(annale.get("questions"), list) else []
    groups: dict[str, list[dict[str, Any]]] = {}
    for q in questions:
        if not isinstance(q, dict):
            continue
        sid = q.get("seriesId")
        if not sid:
            q["seriesId"] = None
            q["seriesFormat"] = None
            q["seriesPosition"] = None
            q["seriesTotal"] = None
            continue
        groups.setdefault(str(sid), []).append(q)
    for group in groups.values():
        total = len(group)
        fmt = group[0].get("seriesFormat") or "DP"
        if fmt not in VALID_SERIES_FORMATS:
            fmt = "DP"
        for index, q in enumerate(group, start=1):
            q["seriesFormat"] = fmt
            q["seriesPosition"] = index
            q["seriesTotal"] = total


def validate_annale_admin(annale: dict[str, Any]) -> dict[str, Any]:
    issues = []
    questions = annale.get("questions") if isinstance(annale.get("questions"), list) else []
    series: dict[str, list[dict[str, Any]]] = {}

    if not questions:
        issues.append(_issue("error", None, "annale-empty", "Annale sans question."))

    for index, q in enumerate(questions, start=1):
        if not isinstance(q, dict):
            issues.append(_issue("error", None, "question-invalid", f"Question #{index} invalide."))
            continue
        qid = q.get("id") or f"#{index}"
        qtype = q.get("questionType")
        text = str(q.get("text") or "").strip()
        options = q.get("options")
        if not text:
            issues.append(_issue("error", qid, "question-empty", "Enonce vide."))
        if qtype not in VALID_QUESTION_TYPES:
            issues.append(_issue("error", qid, "type-invalid", f"Type invalide : {qtype!r}."))
        if qtype in {"QRU", "QRM"}:
            if not isinstance(options, list) or not options:
                issues.append(_issue("error", qid, "options-missing", f"{qtype}: options manquantes."))
            else:
                correct_count = 0
                seen_text = set()
                for opt in options:
                    if not isinstance(opt, dict):
                        issues.append(_issue("error", qid, "option-invalid", "Option invalide."))
                        continue
                    opt_text = str(opt.get("text") or "").strip()
                    if not opt_text:
                        issues.append(_issue("error", qid, "option-empty", f"Option {opt.get('id') or '?'} vide."))
                    folded = re.sub(r"\s+", " ", opt_text.lower())
                    if folded in seen_text:
                        issues.append(_issue("warning", qid, "option-duplicate", f"Option dupliquee : {opt_text[:80]}"))
                    seen_text.add(folded)
                    if opt.get("correct"):
                        correct_count += 1
                if qtype == "QRU" and correct_count != 1:
                    issues.append(_issue("error", qid, "qru-correct-count", f"QRU: {correct_count} bonnes reponses."))
                if qtype == "QRM" and correct_count < 1:
                    issues.append(_issue("error", qid, "qrm-no-correct", "QRM sans bonne reponse."))
        if qtype in {"QROC", "ZONE"} and not str(q.get("expectedAnswer") or "").strip():
            issues.append(_issue("warning", qid, "expected-answer-missing", "Reponse attendue vide."))
        if q.get("seriesId"):
            series.setdefault(str(q.get("seriesId")), []).append(q)
            if q.get("seriesFormat") not in VALID_SERIES_FORMATS:
                issues.append(_issue("error", qid, "series-format-invalid", "Format de serie invalide."))
        blob = " ".join(str(q.get(k) or "") for k in ("text", "correctionText", "vignette"))
        has_image = bool(q.get("image")) or bool(q.get("images"))
        if IMAGE_HINT_RE.search(blob) and not has_image:
            issues.append(_issue("warning", qid, "image-expected-missing", "Image probablement attendue mais absente."))

    for sid, group in series.items():
        expected_total = len(group)
        has_vignette = any(str(q.get("vignette") or "").strip() for q in group)
        if not has_vignette:
            issues.append(_issue("warning", group[0].get("id"), "series-vignette-missing", f"{sid}: aucune vignette visible."))
        for q in group:
            if q.get("seriesTotal") not in (None, expected_total):
                issues.append(_issue("error", q.get("id"), "series-total-mismatch", f"{sid}: seriesTotal incoherent."))

    counts = {
        "error": sum(1 for i in issues if i["severity"] == "error"),
        "warning": sum(1 for i in issues if i["severity"] == "warning"),
        "info": sum(1 for i in issues if i["severity"] == "info"),
    }
    return {"ok": counts["error"] == 0, "issues": issues, "counts": counts}


def touch_annale_revision(annale: dict[str, Any]) -> None:
    annale["revision"] = int(annale.get("revision") or 0) + 1
    annale["updatedAt"] = utc_now_iso()


def decode_data_url_image(data_url: str) -> tuple[bytes, str]:
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        raise ValueError("dataUrl image invalide")
    header, encoded = data_url.split(",", 1)
    mime = header.split(";", 1)[0].replace("data:", "")
    ext = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
    }.get(mime)
    if not ext:
        raise ValueError(f"type image non supporte : {mime}")
    try:
        return base64.b64decode(encoded, validate=True), ext
    except Exception as exc:
        raise ValueError(f"image base64 invalide : {exc}") from exc


def write_question_image(images_dir: str, qid: str, data_url: str) -> str:
    data, ext = decode_data_url_image(data_url)
    os.makedirs(images_dir, exist_ok=True)
    base = safe_slug(qid, fallback="question")
    filename = f"{base}.{ext}"
    counter = 2
    while os.path.exists(os.path.join(images_dir, filename)):
        filename = f"{base}-{counter}.{ext}"
        counter += 1
    with open(os.path.join(images_dir, filename), "wb") as fh:
        fh.write(data)
    return filename


def _normalize_options(options: list[Any]) -> list[dict[str, Any]]:
    normalized = []
    for index, opt in enumerate(options):
        if not isinstance(opt, dict):
            raise ValueError(f"options[{index}] : objet attendu")
        text = str(opt.get("text") or "").strip()
        if not text:
            raise ValueError(f"options[{index}].text vide")
        normalized.append({
            "id": OPTION_LETTERS[index],
            "text": text[:5000],
            "correct": bool(opt.get("correct")),
        })
    return normalized


def _clean_optional(value: Any, max_len: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    cleaned = value.strip()[:max_len]
    return cleaned or None


def _int_or_none(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _issue(severity: str, qid: str | None, code: str, message: str) -> dict[str, Any]:
    return {"severity": severity, "questionId": qid, "code": code, "message": message}
