"""Repair QROC-generated annales whose clinical vignettes stayed in drafts.

Usage:
    python -m tools.repair_qroc_vignettes
    python -m tools.repair_qroc_vignettes --annale neurologie-2025-s1-2
    python -m tools.repair_qroc_vignettes --apply

The script is read-only by default. With --apply it:
- reads published QROC drafts under data/annales/_drafts;
- extracts the clinical vignette from each sourceBlock before QUESTION 1 / 1.;
- extracts deterministic clinical updates placed between source questions;
- maps generated draft questions to the published annale by question id;
- groups ungrouped published questions from the same sourceBlock into a DP;
- updates existing repaired DP series when only incremental vignettes are missing;
- writes the published annale and its draft atomically, with backup and audit log.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.storage import (  # noqa: E402
    BackupManager,
    audit,
    read_json_file,
    safe_slug,
    utc_now_iso,
    write_json_file,
)
from core.text_utils import fold_ascii  # noqa: E402


ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = ROOT / "data"
ANNALES_DIR = DATA_ROOT / "annales"
DRAFTS_DIR = ANNALES_DIR / "_drafts"
BACKUPS_DIR = DATA_ROOT / "_backups"
AUDIT_PATH = DATA_ROOT / "_audit.jsonl"

SCRIPT_VERSION = "1.2"

QUESTION_1_RE = re.compile(
    r"(?im)^\s*(?:question\s*1\s*[\.:)\-]?|1\s*[\.)\-](?!\d))"
)
QUESTION_MARKER_RE = re.compile(
    r"(?im)^\s*(?:question\s*(\d{1,2})\s*[\.:)\-]?|(\d{1,2})\s*[\.)\-](?!\d))"
)
QROC_TITLE_RE = re.compile(
    r"(?i)^\s*qroc\s*(?:n[°o]\s*)?\d+\s*(?:[.\-:\u2013\u2014].*)?$"
)
NOISE_LINE_RE = re.compile(
    r"(?i)^\s*(?:\d{1,3}|annee universitaire.*|med-\d+.*|vendredi\s+\d+.*|"
    r"systeme\s+.*session.*|faculte\s+.*|universite\s+.*)\s*$"
)
CASE_START_RE = re.compile(
    r"(?i)\b("
    r"vous\s+(?:recevez|prenez|examinez|administrez|etes|êtes)|"
    r"m[eé]decin|un\s+(?:patient|homme|petit|jeune)|"
    r"une\s+(?:patiente|femme|jeune)|madame|mme\.?|monsieur|mr\.?|m\.\s|"
    r"chez\s+un\s+patient|chez\s+une\s+patiente"
    r")\b"
)
PERSON_RE = re.compile(
    r"\b(madame|mme\.?|monsieur|mr\.?|m\.\s|patient|patiente|homme|femme|"
    r"enfant|nourrisson|garcon|fille|adolescent|adolescente)\b"
)
AGE_RE = re.compile(r"\b\d{1,3}\s*ans\b|agee?\s+de\s+\d{1,3}")
CARE_CONTEXT_RE = re.compile(
    r"\b(consulte|consultation|vous recevez|vous realisez|vous réalisez|se presente|est admis|est admise|hospitalise|"
    r"hospitalisee|adresse|amene|urgence|urgences|examinez|examen clinique|"
    r"prenez en charge|de garde|aux urgences)\b"
)
CASE_VERB_RE = re.compile(
    r"\b(presente|se plaint|diagnostiquez|suspectez|retrouvez|constatez|"
    r"est atteint|atteint d|pensez prescrire|vous pensez prescrire)\b"
)
INTER_ADDITION_START_RE = re.compile(
    r"(?i)\b("
    r"vous\s+(?:realisez|réalisez|demandez|effectuez|prescrivez|reverrez|revoyez)|"
    r"l['’](?:examen|ecg|eeg|irm|imagerie|enmg)|"
    r"le\s+(?:scanner|bilan)|la\s+biologie|"
    r"les\s+(?:resultats|résultats|troponines|d-dimeres|d-dimères|examens)|"
    r"l['’](?:h[eé]mogramme)|six\s+ans\s+plus\s+tard|"
    r"par\s+ailleurs|a\s+h\d+|à\s+h\d+|evolution|évolution"
    r")\b"
)
QUESTION_DEMAND_RE = re.compile(
    r"(?i)\b("
    r"quel(?:le|les|s)?|quels?\s+sont|quelle?\s+est|"
    r"que\s+(?:recherchez|pensez|proposez|faites|demandez|lui|dites|repondez|répondez)|"
    r"citez|decrivez|décrivez|detaillez|détaillez|traduisez|expliquez|justifiez|"
    r"ou\s+situez|où\s+situez|dans\s+cette\s+situation"
    r")\b"
)
OBSERVATION_CONTEXT_RE = re.compile(
    r"\b(ceci\s+est|voici|image|imagerie|otoscopie|ecg|eeg|irm|scanner|"
    r"radiographie|lampe\s+a\s+fente|lampe\s+à\s+fente)\b"
)


@dataclass
class RepairCandidate:
    annale_id: str
    draft_id: str
    block_id: str
    block_title: str
    question_ids: list[str]
    series_id: str
    vignette: str
    vignettes_by_qid: dict[str, str | None]


def _fold_basic(text: str) -> str:
    return (
        str(text or "")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\u00a0", " ")
        .strip()
    )


def _compact_vignette(text: str) -> str:
    lines: list[str] = []
    for raw in _fold_basic(text).split("\n"):
        line = raw.strip()
        if not line:
            continue
        if QROC_TITLE_RE.match(line):
            continue
        if NOISE_LINE_RE.match(line):
            continue
        lines.append(line)
    compact = " ".join(lines)
    compact = re.sub(r"\s+", " ", compact).strip(" \t\n-:;")
    if compact.lower().startswith("qroc"):
        start = CASE_START_RE.search(compact)
        if start and start.start() < 240:
            compact = compact[start.start():]
    compact = re.sub(r"(?i)\s+ann[eé]e universitaire\b.*$", "", compact).strip()
    return compact


def _normalize_question_text(text: str | None) -> str:
    return re.sub(r"\s+", " ", fold_ascii(str(text or "")).lower()).strip()


def _question_text_similarity(left: str | None, right: str | None) -> float:
    a = _normalize_question_text(left)
    b = _normalize_question_text(right)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if min(len(a), len(b)) >= 12 and (a in b or b in a):
        return 0.92
    return difflib.SequenceMatcher(None, a, b).ratio()


def _direct_question_match(
    draft_question: dict[str, Any],
    published_questions: list[dict[str, Any]],
    used_indices: set[int],
) -> tuple[int, float] | None:
    """Return a reliable direct match by id+text, exact text, or high text similarity."""
    draft_id = str(draft_question.get("id") or "")
    draft_text = draft_question.get("text")

    if draft_id:
        for index, question in enumerate(published_questions):
            if index in used_indices:
                continue
            if str(question.get("id") or "") != draft_id:
                continue
            ratio = _question_text_similarity(draft_text, question.get("text"))
            if ratio >= 0.98 or not str(draft_text or "").strip() or not str(question.get("text") or "").strip():
                return index, ratio

    normalized = _normalize_question_text(draft_text)
    if normalized:
        exact_matches = [
            index
            for index, question in enumerate(published_questions)
            if index not in used_indices and _normalize_question_text(question.get("text")) == normalized
        ]
        if len(exact_matches) == 1:
            return exact_matches[0], 1.0

    scored = sorted(
        (
            (_question_text_similarity(draft_text, question.get("text")), index)
            for index, question in enumerate(published_questions)
            if index not in used_indices
        ),
        reverse=True,
    )
    if not scored:
        return None
    best_score, best_index = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0.0
    if best_score >= 0.78 and best_score - second_score >= 0.08:
        return best_index, best_score
    return None


def _map_block_questions_to_published(
    block_questions: list[dict[str, Any]],
    published_questions: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """
    Map draft questions from one source block to published questions.

    Published annales can be renumbered after deletion/review, so draft ids are
    not reliable enough. We first find strong text anchors, then infer the
    contiguous published range for the whole source block.
    """
    if not block_questions or not published_questions:
        return []

    anchors: list[tuple[int, int]] = []
    used_indices: set[int] = set()
    for local_index, draft_question in enumerate(block_questions):
        match = _direct_question_match(draft_question, published_questions, used_indices)
        if not match:
            continue
        published_index, _score = match
        anchors.append((local_index, published_index))
        used_indices.add(published_index)

    if not anchors:
        return []

    offsets: dict[int, int] = {}
    for local_index, published_index in anchors:
        offset = published_index - local_index
        offsets[offset] = offsets.get(offset, 0) + 1
    best_offset = sorted(offsets.items(), key=lambda item: (-item[1], abs(item[0])))[0][0]

    mapped: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for local_index, draft_question in enumerate(block_questions):
        published_index = best_offset + local_index
        if published_index < 0 or published_index >= len(published_questions):
            continue
        published_question = published_questions[published_index]
        direct_ratio = _question_text_similarity(draft_question.get("text"), published_question.get("text"))
        if direct_ratio < 0.45 and offsets.get(best_offset, 0) < 2:
            continue
        mapped.append((draft_question, published_question))
    return mapped


def looks_like_clinical_vignette(vignette: str) -> bool:
    """Conservative test: person/case marker plus age, care context, or case verb."""
    folded = fold_ascii(vignette).lower()
    if OBSERVATION_CONTEXT_RE.search(folded):
        return True
    if not PERSON_RE.search(folded):
        return False
    return bool(
        AGE_RE.search(folded)
        or CARE_CONTEXT_RE.search(folded)
        or CASE_VERB_RE.search(folded)
    )


def extract_vignette_from_source_block(block: dict[str, Any], min_chars: int = 40) -> str | None:
    """Return the intro clinical vignette found before QUESTION 1, or None."""
    text = _fold_basic(block.get("cleanText") or block.get("rawText") or "")
    if not text:
        return None
    match = QUESTION_1_RE.search(text)
    if not match:
        return None
    vignette = _compact_vignette(text[: match.start()])
    if len(vignette) < min_chars:
        return None
    if not looks_like_clinical_vignette(vignette):
        return None
    return vignette


def _marker_number(match: re.Match[str]) -> int | None:
    raw = match.group(1) or match.group(2)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _clean_addition(text: str) -> str | None:
    cleaned = _compact_vignette(text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" \t\n-:;")
    if len(cleaned) < 40:
        return None
    if not looks_like_clinical_vignette(cleaned):
        return None
    return cleaned


def _extract_inter_question_addition(segment: str) -> str | None:
    """Find new clinical information placed after an answer and before next marker."""
    compact = " ".join(
        line.strip()
        for line in _fold_basic(segment).splitlines()
        if line.strip() and not NOISE_LINE_RE.match(line.strip())
    )
    if not compact:
        return None
    matches = list(INTER_ADDITION_START_RE.finditer(compact))
    if not matches:
        return None
    # Prefer the first cue that does not still look like the current question
    # stem. Some corrected PDFs place a context-looking phrase in the question
    # itself ("Le bilan... Par quelles techniques ?") before the real update.
    for match in matches:
        candidate = compact[match.start():]
        demand = QUESTION_DEMAND_RE.search(candidate)
        if demand and demand.start() < 260:
            continue
        cleaned = _clean_addition(candidate)
        if cleaned:
            return cleaned
    return None


def _extract_question_prefix_addition(segment: str) -> str | None:
    """Extract declarative clinical context inside a later question stem."""
    compact = " ".join(
        line.strip()
        for line in _fold_basic(segment).splitlines()
        if line.strip() and not NOISE_LINE_RE.match(line.strip())
    )
    if not compact:
        return None
    demand = QUESTION_DEMAND_RE.search(compact)
    if not demand or demand.start() < 35:
        return None
    prefix = compact[: demand.start()].strip(" \t\n-:;")
    return _clean_addition(prefix)


def extract_incremental_additions_from_source_block(block: dict[str, Any]) -> list[tuple[int, str]]:
    """Return [(source_anchor_position, added_clinical_text)] from source block."""
    text = _fold_basic(block.get("cleanText") or block.get("rawText") or "")
    markers = list(QUESTION_MARKER_RE.finditer(text))
    if len(markers) < 2:
        return []
    additions: list[tuple[int, str]] = []
    seen: set[str] = set()

    def add(anchor: int, value: str | None):
        if not value:
            return
        folded = fold_ascii(value).lower()
        if folded in seen:
            return
        seen.add(folded)
        additions.append((anchor, value))

    for index, marker in enumerate(markers):
        number = _marker_number(marker)
        next_start = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        segment = text[marker.end():next_start]

        if number and number > 1:
            add(marker.start(), _extract_question_prefix_addition(segment))

        if index + 1 < len(markers):
            # A narrative update after the current answer belongs to the next
            # source question, so anchor it at the next marker.
            add(markers[index + 1].start(), _extract_inter_question_addition(segment))

    return sorted(additions, key=lambda item: item[0])


def _source_position_for_generated_question(question: dict[str, Any], source_text: str) -> int | None:
    positions: list[int] = []
    for ref in question.get("sourceRefs") or []:
        ref_text = str(ref or "").strip()
        if not ref_text:
            continue
        found = source_text.find(ref_text)
        if found >= 0:
            positions.append(found)
    text = str(question.get("text") or "").strip()
    if text:
        found = source_text.find(text)
        if found >= 0:
            positions.append(found)
    return min(positions) if positions else None


def build_cumulative_vignettes(
    block: dict[str, Any],
    draft_questions: list[dict[str, Any]],
    question_ids: list[str],
    base_vignette: str,
) -> dict[str, str | None]:
    """Build Q1 base vignette plus cumulative later vignettes when source adds context."""
    vignettes: dict[str, str | None] = {qid: None for qid in question_ids}
    if question_ids:
        vignettes[question_ids[0]] = base_vignette

    additions = extract_incremental_additions_from_source_block(block)
    if not additions:
        return vignettes

    source_text = _fold_basic(block.get("cleanText") or block.get("rawText") or "")
    positioned: list[tuple[str, int | None, int]] = []
    for order, qid in enumerate(question_ids):
        draft_question = draft_questions[order] if order < len(draft_questions) else {}
        positioned.append((qid, _source_position_for_generated_question(draft_question, source_text), order))

    cumulative_parts: list[str] = []
    used_target_qids: set[str] = set()
    for anchor, addition in additions:
        if fold_ascii(addition).lower() in fold_ascii(base_vignette).lower():
            continue
        cumulative_parts.append(addition)
        target_qid: str | None = None
        for qid, source_pos, order in positioned:
            if order == 0:
                continue
            if source_pos is not None and source_pos >= anchor:
                target_qid = qid
                break
        if target_qid is None:
            # Fallback: map the nth addition to the next generated question.
            fallback_index = min(len(cumulative_parts), len(question_ids) - 1)
            if fallback_index > 0:
                target_qid = question_ids[fallback_index]
        if not target_qid:
            continue
        used_target_qids.add(target_qid)
        vignettes[target_qid] = base_vignette + "\n\n" + "\n\n".join(cumulative_parts)

    # If a later target had no direct sourceRef but a previous cumulative update
    # exists, leaving it None is intentional: the UI shows prior additions for
    # subsequent positions through computeSeriesVignettes().
    return vignettes


def _published_annale_id(draft: dict[str, Any]) -> str | None:
    publish_log = draft.get("publishLog") if isinstance(draft.get("publishLog"), dict) else {}
    meta = draft.get("meta") if isinstance(draft.get("meta"), dict) else {}
    return publish_log.get("annaleId") or meta.get("annaleId")


def _is_published_draft(draft: dict[str, Any]) -> bool:
    return (
        draft.get("status") == "published"
        or isinstance(draft.get("publishLog"), dict)
        or bool(draft.get("publishedAt"))
    )


def iter_published_drafts(annale_filter: set[str] | None = None, draft_filter: set[str] | None = None):
    if not DRAFTS_DIR.is_dir():
        return
    for path in sorted(DRAFTS_DIR.glob("*.json")):
        draft_id = path.stem
        if draft_filter and draft_id not in draft_filter:
            continue
        try:
            draft = read_json_file(str(path))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[WARN] draft illisible {path.name}: {exc}", file=sys.stderr)
            continue
        if not isinstance(draft, dict) or not _is_published_draft(draft):
            continue
        annale_id = _published_annale_id(draft)
        if not annale_id:
            continue
        if annale_filter and annale_id not in annale_filter:
            continue
        yield path, draft, annale_id


def _series_has_vignette(questions: list[dict[str, Any]], series_id: str) -> bool:
    return any(
        q.get("seriesId") == series_id and bool(str(q.get("vignette") or "").strip())
        for q in questions
    )


def _build_series_id(annale_id: str, draft_id: str, block_id: str, question_ids: list[str]) -> str:
    raw = f"{annale_id}|{draft_id}|{block_id}|{','.join(question_ids)}".encode("utf-8")
    suffix = hashlib.md5(raw).hexdigest()[:8]
    slug = safe_slug(block_id, fallback="bloc", max_len=24)
    return f"dp-{slug}-{suffix}"


def find_repair_candidates(
    draft: dict[str, Any],
    annale: dict[str, Any],
    annale_id: str,
    min_vignette_chars: int = 40,
) -> tuple[list[RepairCandidate], list[str]]:
    questions = [q for q in (annale.get("questions") or []) if isinstance(q, dict)]
    generated_by_block: dict[str, list[dict[str, Any]]] = {}
    for q in draft.get("generatedQuestions") or []:
        if not isinstance(q, dict):
            continue
        block_id = str(q.get("_sourceBlockId") or q.get("sourceBlockId") or "").strip()
        if not block_id:
            continue
        generated_by_block.setdefault(block_id, []).append(q)

    series_vignette_cache: dict[str, bool] = {}
    candidates: list[RepairCandidate] = []
    skipped: list[str] = []

    draft_id = str(draft.get("id") or "")
    for block in draft.get("sourceBlocks") or []:
        if not isinstance(block, dict):
            continue
        block_id = str(block.get("id") or "").strip()
        if not block_id:
            continue
        vignette = extract_vignette_from_source_block(block, min_chars=min_vignette_chars)
        if not vignette:
            continue

        block_draft_questions = generated_by_block.get(block_id) or []
        mapped_pairs = _map_block_questions_to_published(block_draft_questions, questions)
        draft_questions = [pair[0] for pair in mapped_pairs]
        published_questions = [pair[1] for pair in mapped_pairs]

        if len(published_questions) < 2:
            skipped.append(f"{annale_id}/{block_id}: moins de 2 questions publiees rattachees")
            continue

        existing_series = [q.get("seriesId") for q in published_questions if q.get("seriesId")]
        unique_existing_series = sorted({str(sid) for sid in existing_series if sid})
        force_new_series = False
        if existing_series:
            if len(unique_existing_series) > 1:
                force_new_series = True
            else:
                already_ok = True
                for sid in unique_existing_series:
                    if sid not in series_vignette_cache:
                        series_vignette_cache[sid] = _series_has_vignette(questions, sid)
                    if not series_vignette_cache[sid]:
                        already_ok = False
                        break
                if not already_ok:
                    skipped.append(f"{annale_id}/{block_id}: serie existante sans vignette, cas ambigu")
                    continue

        ordered = sorted(
            published_questions,
            key=lambda q: questions.index(q) if q in questions else 10_000,
        )
        question_ids = [str(q.get("id")) for q in ordered]
        ordered_draft_questions = [
            draft_question
            for draft_question, published_question in sorted(
                mapped_pairs,
                key=lambda pair: questions.index(pair[1]) if pair[1] in questions else 10_000,
            )
        ]
        series_id = (
            unique_existing_series[0]
            if unique_existing_series and not force_new_series
            else _build_series_id(annale_id, draft_id, block_id, question_ids)
        )
        planned_vignettes = build_cumulative_vignettes(block, ordered_draft_questions, question_ids, vignette)

        if unique_existing_series:
            has_increment = any(planned_vignettes.get(qid) for qid in question_ids[1:])
            has_change = False
            for question in ordered:
                qid = str(question.get("id"))
                current = str(question.get("vignette") or "").strip() or None
                planned = planned_vignettes.get(qid)
                if planned != current:
                    has_change = True
                    break
            existing_title = str(ordered[0].get("customTitle") or "").strip()
            if existing_title and existing_title != str(block.get("title") or block_id).strip():
                has_change = True
            if not has_change:
                continue

        candidates.append(
            RepairCandidate(
                annale_id=annale_id,
                draft_id=draft_id,
                block_id=block_id,
                block_title=str(block.get("title") or block_id).strip(),
                question_ids=question_ids,
                series_id=series_id,
                vignette=vignette,
                vignettes_by_qid=planned_vignettes,
            )
        )

    return candidates, skipped


def apply_candidate_to_questions(
    questions: list[dict[str, Any]],
    candidate: RepairCandidate,
    qid_key: str = "id",
) -> int:
    qid_set = set(candidate.question_ids)
    selected = [q for q in questions if str(q.get(qid_key) or "") in qid_set]
    selected.sort(key=lambda q: candidate.question_ids.index(str(q.get(qid_key))))
    total = len(selected)
    for position, q in enumerate(selected, start=1):
        qid = str(q.get(qid_key) or "")
        q["seriesId"] = candidate.series_id
        q["seriesFormat"] = "DP"
        q["seriesPosition"] = position
        q["seriesTotal"] = total
        q["customTitle"] = candidate.block_title
        q["vignette"] = candidate.vignettes_by_qid.get(qid)
    return total


def apply_candidates(
    annale: dict[str, Any],
    draft: dict[str, Any],
    candidates: list[RepairCandidate],
) -> int:
    total = 0
    annale_questions = [q for q in (annale.get("questions") or []) if isinstance(q, dict)]
    draft_questions = [q for q in (draft.get("generatedQuestions") or []) if isinstance(q, dict)]
    for candidate in candidates:
        total += apply_candidate_to_questions(annale_questions, candidate)
        apply_candidate_to_questions(draft_questions, candidate)
    draft["updatedAt"] = utc_now_iso()
    draft.setdefault("repairLog", []).append(
        {
            "at": utc_now_iso(),
            "script": "repair_qroc_vignettes",
            "version": SCRIPT_VERSION,
            "blocks": [
                {
                    "blockId": c.block_id,
                    "seriesId": c.series_id,
                    "questionIds": c.question_ids,
                }
                for c in candidates
            ],
        }
    )
    return total


def _print_candidate(candidate: RepairCandidate) -> None:
    preview = candidate.vignette[:180] + ("..." if len(candidate.vignette) > 180 else "")
    increments = sum(
        1 for qid in candidate.question_ids[1:]
        if candidate.vignettes_by_qid.get(qid)
    )
    print(
        f"- {candidate.annale_id} | {candidate.block_id} | "
        f"{len(candidate.question_ids)} questions -> {candidate.series_id}"
        f" | increments: {increments}"
    )
    print(f"  questions: {', '.join(candidate.question_ids)}")
    print(f"  vignette : {preview}")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m tools.repair_qroc_vignettes",
        description="Repair missing DP vignettes in published QROC annales from saved drafts.",
    )
    parser.add_argument("--apply", action="store_true", help="Write repairs. Default is dry-run.")
    parser.add_argument("--annale", action="append", default=None, help="Published annale id to scan.")
    parser.add_argument("--draft", action="append", default=None, help="Draft id to scan.")
    parser.add_argument("--min-vignette-chars", type=int, default=40)
    parser.add_argument("--no-audit", action="store_true", help="Disable audit log.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    if not args.no_audit:
        audit.configure(str(AUDIT_PATH))

    annale_filter = set(args.annale or []) or None
    draft_filter = set(args.draft or []) or None
    print(f"Hypocampus repair_qroc_vignettes v{SCRIPT_VERSION}")
    print(f"mode: {'APPLY' if args.apply else 'DRY-RUN'}")

    all_candidates: list[tuple[Path, dict[str, Any], Path, dict[str, Any], list[RepairCandidate]]] = []
    skipped_total: list[str] = []
    scanned = 0

    for draft_path, draft, annale_id in iter_published_drafts(annale_filter, draft_filter):
        scanned += 1
        annale_path = ANNALES_DIR / f"{annale_id}.json"
        if not annale_path.is_file():
            skipped_total.append(f"{annale_id}: annale publiee introuvable")
            continue
        try:
            annale = read_json_file(str(annale_path))
        except (OSError, json.JSONDecodeError) as exc:
            skipped_total.append(f"{annale_id}: lecture impossible: {exc}")
            continue
        candidates, skipped = find_repair_candidates(
            draft, annale, annale_id, min_vignette_chars=args.min_vignette_chars
        )
        skipped_total.extend(skipped)
        if candidates:
            all_candidates.append((draft_path, draft, annale_path, annale, candidates))

    candidate_count = sum(len(cands) for *_rest, cands in all_candidates)
    question_count = sum(len(c.question_ids) for *_rest, cands in all_candidates for c in cands)
    print(f"drafts scannes: {scanned}")
    print(f"blocs reparables: {candidate_count}")
    print(f"questions a rattacher: {question_count}")
    if skipped_total:
        print(f"cas ignores: {len(skipped_total)}")

    for _draft_path, _draft, _annale_path, _annale, candidates in all_candidates:
        for candidate in candidates:
            _print_candidate(candidate)

    if not args.apply:
        print("\n[DRY-RUN] aucune modification ecrite. Relancer avec --apply pour appliquer.")
        return 0
    if not all_candidates:
        print("Rien a appliquer.")
        return 0

    backup_manager = BackupManager(str(DATA_ROOT), str(BACKUPS_DIR), retention=30)
    backup_info = backup_manager.create()
    print(f"\nbackup cree: {backup_info['filename']}")

    applied_blocks = 0
    applied_questions = 0
    for draft_path, draft, annale_path, annale, candidates in all_candidates:
        applied_questions += apply_candidates(annale, draft, candidates)
        write_json_file(str(annale_path), annale)
        write_json_file(str(draft_path), draft)
        applied_blocks += len(candidates)
        audit.log(
            "repair_qroc_vignettes",
            {
                "annaleId": annale.get("id") or annale_path.stem,
                "draftId": draft.get("id") or draft_path.stem,
                "blocks": [
                    {
                        "blockId": c.block_id,
                        "seriesId": c.series_id,
                        "questionIds": c.question_ids,
                    }
                    for c in candidates
                ],
                "scriptVersion": SCRIPT_VERSION,
                "backupFilename": backup_info["filename"],
            },
        )

    print(f"applique: {applied_blocks} blocs, {applied_questions} questions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
