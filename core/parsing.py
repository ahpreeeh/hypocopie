"""
core.parsing — Parseurs PDF UNESS et QROC.

3 entrées publiques :
- `extract_pdf_text(pdf_bytes)` : texte brut + nombre de pages (utilise pypdf).
- `parse_qroc_source_pdf(pdf_bytes, meta, draft_id, images_dir, filename=None)` :
  découpe un PDF QROC en blocs source (layout PyMuPDF) avec images détachées.
- `parse_uness_correction_local(pdf_bytes, meta)` : parseur déterministe pour les
  PDFs UNESS textuels avec cases cochées. Retourne (annale, report, raw_text).
- `write_annale_images(annale, images_dir)` : écrit les images attachées à l'annale.

Tous les chemins de stockage sont passés en argument pour découpler le parseur
de la config globale (data root, ROOT, etc.).
"""

import io
import os
import re

from .storage import safe_filename, safe_slug
from .text_utils import clean_pdf_text, fold_ascii
from .qroc_blocks import is_qroc_block_start, is_generic_question_start, validate_source_block
from .storage import utc_now_iso
from .options import shuffle_questions_options


# ────────────────────────────────────────────────────────────────────
# Regex partagés pour détection de vignettes implicites
# (utilisé par parse_uness_correction_local quand aucun header DP/KFP
# explicite n'est présent dans le PDF UNESS)
# ────────────────────────────────────────────────────────────────────

_PATIENT_MARKER_RE = re.compile(
    r"\b(Madame|Mme|Mr\.?|Monsieur|M\.\s|une?\s+patient[e]?\b|le\s+patient\b|"
    r"la\s+patient[e]?\b|cette\s+patient[e]?\b|ce\s+patient\b)",
    re.IGNORECASE,
)

_ADMISSION_VERB_RE = re.compile(
    r"(pr[ée]sente|consulte|est\s+admis[e]?|est\s+hospitalis[ée]?|"
    r"se\s+pr[ée]sente|vient\s+consulter|est\s+r[ée]f[ée]r[ée]?|"
    r"est\s+adress[ée]?|est\s+re[çc]ue?)",
    re.IGNORECASE,
)

_PATIENT_REFERENCE_RE = re.compile(
    r"\b(madame|mme|monsieur|mr\.?|m\.\s|cette\s+patient[e]?|"
    r"ce\s+patient|chez\s+(le|la)\s+patient[e]?)\b",
    re.IGNORECASE,
)

# Court préfixe pour extraire un "label patient" à partir d'un paragraphe vignette
# (utilisé comme customTitle de la série virtuelle).
_PATIENT_LABEL_RE = re.compile(
    r"(Madame\s+[A-ZÉÈÀÂÄÔÖÛÜÇ][\wéèàâäôöûüç\-]*"
    r"|Mme\s+[A-ZÉÈÀÂÄÔÖÛÜÇ][\wéèàâäôöûüç\-]*"
    r"|Monsieur\s+[A-ZÉÈÀÂÄÔÖÛÜÇ][\wéèàâäôöûüç\-]*"
    r"|Mr\.?\s+[A-ZÉÈÀÂÄÔÖÛÜÇ][\wéèàâäôöûüç\-]*"
    r"|M\.\s+[A-ZÉÈÀÂÄÔÖÛÜÇ][\wéèàâäôöûüç\-]*)",
)


# ────────────────────────────────────────────────────────────────────
# Extraction texte brut (pypdf)
# ────────────────────────────────────────────────────────────────────


def extract_pdf_text(pdf_bytes):
    """Extrait le texte brut d'un PDF via pypdf. Retourne (texte, nb_pages)."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("pypdf manquant. Installe-le avec : python -m pip install pypdf") from exc

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as exc:
        raise RuntimeError(f"PDF illisible : {exc}") from exc

    if getattr(reader, "is_encrypted", False):
        try:
            reader.decrypt("")
        except Exception as exc:
            raise RuntimeError(f"PDF chiffre non lisible : {exc}") from exc

    chunks = []
    total_pages = len(reader.pages)
    for index, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception as exc:
            text = f"[ERREUR EXTRACTION PAGE {index + 1}: {exc}]"
        chunks.append(f"\n========== PAGE {index + 1} / {total_pages} ==========\n{text}\n")

    full_text = "".join(chunks).strip()
    if len(full_text) < 200:
        raise RuntimeError("Texte PDF trop court ou non extractible. Probable PDF scanne/image : il faudra OCR.")
    return full_text, total_pages


# ────────────────────────────────────────────────────────────────────
# Parser QROC source (PyMuPDF — découpe en blocs avec layout)
# ────────────────────────────────────────────────────────────────────


def _lines_chars(lines, start, end):
    return sum(len(lines[i]["text"]) + 1 for i in range(start, end))


def _faithful_size_chunks(lines, max_chars):
    """Chunk brut par taille quand aucun marqueur de question n'est détectable."""
    segments = []
    cur_start = 0
    cur_chars = 0
    for idx in range(len(lines)):
        cur_chars += len(lines[idx]["text"]) + 1
        if cur_chars >= max_chars:
            segments.append((cur_start, idx + 1))
            cur_start = idx + 1
            cur_chars = 0
    if cur_start < len(lines):
        segments.append((cur_start, len(lines)))
    return segments


def _faithful_segments(lines, max_chars=6000):
    """
    Découpage générique (profil 'faithful', mode « Autre ») : segments respectant les
    frontières de questions (jamais coupées en deux ni fusionnées à moitié), fusionnés
    glouton jusqu'à ~max_chars pour rester sous les limites DeepSeek.
    Sans aucun marqueur détectable → fallback chunk par taille.
    """
    if not lines:
        return []
    starts = sorted({
        idx for idx, line in enumerate(lines)
        if idx == 0 or is_generic_question_start(line["text"])
    })
    atoms = []
    for i, s in enumerate(starts):
        e = starts[i + 1] if i + 1 < len(starts) else len(lines)
        atoms.append((s, e))
    if len(atoms) <= 1:
        return _faithful_size_chunks(lines, max_chars)
    segments = []
    cur_start, cur_end = atoms[0]
    cur_chars = _lines_chars(lines, cur_start, cur_end)
    for (s, e) in atoms[1:]:
        seg_chars = _lines_chars(lines, s, e)
        if cur_chars + seg_chars > max_chars and cur_chars > 0:
            segments.append((cur_start, cur_end))
            cur_start, cur_end, cur_chars = s, e, seg_chars
        else:
            cur_end = e
            cur_chars += seg_chars
    segments.append((cur_start, cur_end))
    return segments


def parse_qroc_source_pdf(pdf_bytes, meta, draft_id, images_dir, filename=None, profile="qroc"):
    """
    Découpe un PDF en blocs source avec coordonnées de layout.
    Les images sont extraites et écrites dans `images_dir` (créé si absent).

    profile :
    - "qroc" (défaut) : découpage aux marqueurs QROC/Dossier/Cas (comportement historique).
    - "faithful" : découpage générique (mode « Autre ») pour PDF variés non-QROC.
    Retourne (draft_dict, raw_text).
    """
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF manquant. Installe-le avec : python -m pip install pymupdf") from exc

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise RuntimeError(f"PDF illisible par PyMuPDF : {exc}") from exc

    lines = []
    images = []
    raw_pages = []
    os.makedirs(images_dir, exist_ok=True)

    for page_index, page in enumerate(doc):
        page_num = page_index + 1
        raw_pages.append(page.get_text("text") or "")
        data = page.get_text("dict")
        for block_index, block in enumerate(data.get("blocks") or []):
            bbox = block.get("bbox") or (0, 0, 0, 0)
            if block.get("type") == 0:
                for line in block.get("lines") or []:
                    spans = line.get("spans") or []
                    text = "".join(span.get("text", "") for span in spans).strip()
                    if not text:
                        continue
                    lb = line.get("bbox") or bbox
                    lines.append({
                        "page": page_num,
                        "x0": float(lb[0]),
                        "y0": float(lb[1]),
                        "x1": float(lb[2]),
                        "y1": float(lb[3]),
                        "text": text,
                        "blockIndex": block_index,
                    })
            elif block.get("type") == 1:
                image_data = block.get("image")
                width = float(bbox[2]) - float(bbox[0])
                height = float(bbox[3]) - float(bbox[1])
                if not image_data or width < 80 or height < 80 or len(image_data) < 8 * 1024:
                    continue
                image_id = f"img-{len(images) + 1}"
                ext = safe_filename(block.get("ext")) or "png"
                filename_img = f"{image_id}.{ext}"
                with open(os.path.join(images_dir, filename_img), "wb") as fh:
                    fh.write(image_data)
                images.append({
                    "id": image_id,
                    "filename": filename_img,
                    "page": page_num,
                    "bbox": [float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])],
                    "width": int(block.get("width") or 0),
                    "height": int(block.get("height") or 0),
                    "bytes": len(image_data),
                })

    lines.sort(key=lambda item: (item["page"], item["y0"], item["x0"]))
    if profile == "faithful":
        segments = _faithful_segments(lines)
    else:
        starts = [idx for idx, line in enumerate(lines) if is_qroc_block_start(line["text"])]
        if not starts:
            starts = [0] if lines else []
        segments = [
            (start, starts[i + 1] if i + 1 < len(starts) else len(lines))
            for i, start in enumerate(starts)
        ]

    source_blocks = []
    for (start, end) in segments:
        block_lines = lines[start:end]
        if not block_lines:
            continue
        text = "\n".join(item["text"] for item in block_lines).strip()
        pages = sorted({item["page"] for item in block_lines})
        per_page_y = {}
        for item in block_lines:
            span = per_page_y.setdefault(item["page"], [item["y0"], item["y1"]])
            span[0] = min(span[0], item["y0"])
            span[1] = max(span[1], item["y1"])
        block = {
            "id": f"sb{len(source_blocks) + 1}",
            "title": block_lines[0]["text"][:120],
            "pages": pages,
            "rawText": text,
            "cleanText": text,
            "ignored": False,
            "images": [],
            "_pageSpans": per_page_y,
        }
        # Mode « Autre » (faithful) : on n'impose pas la structure QROC → les warnings de
        # découpage (bloc court, pas de marqueur QROC, etc.) sont acceptés et non bloquants.
        if profile == "faithful":
            block["warningsOverride"] = "accepted"
        validate_source_block(block)
        source_blocks.append(block)

    for image in images:
        best = None
        best_distance = None
        mid_y = (image["bbox"][1] + image["bbox"][3]) / 2
        for block in source_blocks:
            if image["page"] not in block.get("pages", []):
                continue
            y_span = block.get("_pageSpans", {}).get(image["page"])
            if not y_span:
                continue
            if y_span[0] - 90 <= mid_y <= y_span[1] + 120:
                distance = 0
                confidence = "high"
            else:
                distance = min(abs(mid_y - y_span[0]), abs(mid_y - y_span[1]))
                confidence = "medium" if distance < 220 else "low"
            if best is None or distance < best_distance:
                best = (block, confidence)
                best_distance = distance
        if best:
            linked = dict(image)
            linked["confidence"] = best[1]
            best[0].setdefault("images", []).append(linked)

    for block in source_blocks:
        block.pop("_pageSpans", None)

    draft = {
        "id": draft_id,
        "kind": "qroc-conversion",
        "profile": profile,
        "status": "source-ready",
        "createdAt": utc_now_iso(),
        "updatedAt": utc_now_iso(),
        "meta": {
            "annaleId": meta["id"],
            "title": meta["title"],
            "subject": meta["subject"],
            "year": meta["year"],
            "session": meta.get("session") or None,
            "filename": filename,
        },
        "sourceBlocks": source_blocks,
        "generatedQuestions": [],
        "report": {
            "profile": "faithful-source-layout" if profile == "faithful" else "qroc-source-layout",
            "pages": len(doc),
            "textChars": len("\n".join(raw_pages)),
            "sourceBlocksDetected": len(source_blocks),
            "imagesExtracted": len(images),
            "blockingWarnings": sum(
                1 for block in source_blocks for warning in block.get("warnings") or [] if warning.get("blocking")
            ),
        },
    }
    return draft, "\n\n".join(raw_pages)


# ────────────────────────────────────────────────────────────────────
# Parser UNESS correction (PyMuPDF — déterministe, cases cochées)
# ────────────────────────────────────────────────────────────────────


def parse_uness_correction_local(pdf_bytes, meta):
    """Parse les PDFs de correction UNESS textuels avec coordonnees de layout.

    Ce parseur est volontairement conservateur : si les marqueurs attendus ne sont
    pas presents, il refuse au lieu de produire un JSON douteux.

    Retourne (annale_dict, report_dict, raw_text).
    """
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF manquant. Installe-le avec : python -m pip install pymupdf") from exc

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise RuntimeError(f"PDF illisible par PyMuPDF : {exc}") from exc

    items = []
    raw_pages = []
    for page_index, page in enumerate(doc):
        raw_pages.append(page.get_text("text") or "")
        data = page.get_text("dict")
        for block_index, block in enumerate(data.get("blocks") or []):
            bbox = block.get("bbox") or (0, 0, 0, 0)
            if block.get("type") == 0:
                lines = []
                for line in block.get("lines") or []:
                    text = "".join(span.get("text", "") for span in line.get("spans") or []).strip()
                    if text:
                        lines.append(text)
                text = "\n".join(lines).strip()
                if not text:
                    continue
                if re.fullmatch(r"\d+\s*/\s*\d+", clean_pdf_text(text)):
                    continue
                items.append({
                    "kind": "text",
                    "page": page_index + 1,
                    "x0": float(bbox[0]),
                    "y0": float(bbox[1]),
                    "x1": float(bbox[2]),
                    "y1": float(bbox[3]),
                    "text": text,
                    "lines": lines,
                    "blockIndex": block_index,
                })
            elif block.get("type") == 1:
                width = float(bbox[2]) - float(bbox[0])
                height = float(bbox[3]) - float(bbox[1])
                # Ignore les petites decorations et les grands fonds du PDF.
                if width < 80 or height < 80:
                    continue
                if width > 820 and height > 250:
                    continue
                image_data = block.get("image")
                if not image_data:
                    continue
                # Les PDFs UNESS contiennent beaucoup de rectangles decoratifs
                # exportes comme images tres legeres. Les medias utiles
                # (ECG, imagerie, schemas) sont nettement plus riches.
                if len(image_data) < 8 * 1024:
                    continue
                items.append({
                    "kind": "image",
                    "page": page_index + 1,
                    "x0": float(bbox[0]),
                    "y0": float(bbox[1]),
                    "x1": float(bbox[2]),
                    "y1": float(bbox[3]),
                    "width": int(block.get("width") or 0),
                    "height": int(block.get("height") or 0),
                    "ext": safe_filename(block.get("ext")) or "png",
                    "data": image_data,
                })

    items.sort(key=lambda item: (item["page"], item["y0"], item["x0"]))
    raw_text = "\n\n".join(raw_pages)

    try:
        return _parse_uness_items_to_annale(
            items,
            meta,
            page_count=len(doc),
            raw_text=raw_text,
        )
    except RuntimeError as exc:
        if _looks_like_moodle_correction(raw_text):
            return _parse_moodle_correction_text(raw_text, meta, page_count=len(doc))
        raise exc


# ────────────────────────────────────────────────────────────────────
# Parser Moodle/Hypocampus correction
# ────────────────────────────────────────────────────────────────────


_MOODLE_STATUS_RE = re.compile(
    r"\bQuestion\s+(\d{1,2})\s+(Correct|Partiellement\s+correct|Incorrect)\b",
    re.IGNORECASE,
)
_MOODLE_SECTION_RE = re.compile(
    r"\b(?:(DP\s*\d+|KFP\s*\d+)\s*(?::|(?=\s+(?:Mme|Madame|Monsieur|Mr\.?|M\.\s|"
    r"Un\s+homme|Une\s+femme|Un\s+patient|Une\s+patiente|Vous\s+)))|"
    r"(SERIE\s+DE\s+QI)\s*:)",
    re.IGNORECASE,
)
_MOODLE_CORRECT_RE = re.compile(
    r"\b(?:La\s+r[ée]ponse\s+correcte\s+est|Les\s+r[ée]ponses\s+correctes\s+sont)\s*:\s*(.+)$",
    re.IGNORECASE | re.DOTALL,
)
_MOODLE_OPTION_RE = re.compile(r"(?:^|\s)([a-o])\.\s+", re.IGNORECASE)
_MOODLE_CASE_START_RE = re.compile(
    r"\b(Vous\s+(?:[êe]tes|recevez|voyez|accueillez)|Mme|Madame|Monsieur|Mr\.?|M\.\s|"
    r"Un\s+homme|Une\s+femme|Un\s+patient|Une\s+patiente|De\s+garde|En\s+stage)\b",
    re.IGNORECASE,
)


def _looks_like_moodle_correction(raw_text):
    folded = fold_ascii(raw_text)
    return (
        len(_MOODLE_STATUS_RE.findall(raw_text or "")) >= 5
        and "texte de la question" in folded
        and "feedback" in folded
        and ("la reponse correcte est" in folded or "les reponses correctes sont" in folded)
    )


def _moodle_compact_text(raw_text):
    text = str(raw_text or "")
    replacements = {
        "\ufeff": " ",
        "\u200b": " ",
        "\u2009": " ",
        "\u202f": " ",
        "\ufb01": "fi",
        "\ufb02": "fl",
        "ﬁ": "fi",
        "ﬂ": "fl",
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    return clean_pdf_text(text)


def _moodle_normalize_answer(text):
    folded = fold_ascii(text)
    return re.sub(r"[^a-z0-9]+", "", folded)


def _moodle_strip_option_feedback(text):
    text = clean_pdf_text(text)
    text = re.sub(r"^\s*\d+\s*[.\u200b]*\s*", "", text)
    split = re.split(
        r"\s+(?:\d+\s*[.\u200b]*\s*)?(?:Oui|Non|Vrai|Faux|Cf\s+supra)\b",
        text,
        maxsplit=1,
        flags=re.IGNORECASE,
    )
    return clean_pdf_text(split[0])


def _moodle_parse_options(answer_text):
    matches = list(_MOODLE_OPTION_RE.finditer(answer_text or ""))
    options = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(answer_text)
        option_text = _moodle_strip_option_feedback(answer_text[start:end])
        if not option_text:
            continue
        options.append({
            "id": match.group(1).upper(),
            "text": option_text,
            "correct": False,
        })
    return options


def _moodle_mark_correct_options(options, feedback_text):
    match = _MOODLE_CORRECT_RE.search(feedback_text or "")
    if not match:
        return 0, None
    correct_text = clean_pdf_text(match.group(1))
    correct_norm = _moodle_normalize_answer(correct_text)
    count = 0
    for option in options:
        option_norm = _moodle_normalize_answer(option.get("text"))
        if not option_norm:
            continue
        # Le libellé complet est souvent recopié dans "Les réponses correctes".
        # Pour les options longues, un préfixe substantiel suffit.
        prefix = option_norm[: min(len(option_norm), 80)]
        is_correct = (
            option_norm in correct_norm
            or correct_norm in option_norm
            or (len(prefix) >= 24 and prefix in correct_norm)
        )
        option["correct"] = bool(is_correct)
        if is_correct:
            count += 1
    return count, correct_text


def _moodle_question_text_from_block(block, qnum, synthetic=False):
    text = clean_pdf_text(block)
    if synthetic:
        question_start = 0
    else:
        marker = re.search(r"\bTexte\s+de\s+la\s+question\b", text, re.IGNORECASE)
        question_start = marker.end() if marker else 0
    body = text[question_start:].strip()
    answer_marker = re.search(rf"\bQuestion\s+{qnum}\s+R[ée]ponse\b", body, re.IGNORECASE)
    short_answer_marker = re.search(r"\bR[ée]ponse\s*:", body, re.IGNORECASE)
    feedback_marker = re.search(r"\bFeedback\b", body, re.IGNORECASE)
    marker_candidates = [
        m for m in (answer_marker, short_answer_marker, feedback_marker)
        if m is not None
    ]
    split_at = min((m.start() for m in marker_candidates), default=len(body))
    question_text = clean_pdf_text(body[:split_at])

    answer_text = ""
    feedback_text = ""
    if answer_marker:
        answer_start = answer_marker.end()
    elif short_answer_marker:
        answer_start = short_answer_marker.end()
    else:
        answer_start = split_at
    if feedback_marker:
        answer_text = clean_pdf_text(body[answer_start:feedback_marker.start()])
        feedback_text = clean_pdf_text(body[feedback_marker.end():])
    else:
        answer_text = clean_pdf_text(body[answer_start:])
    return question_text, answer_text, feedback_text


def _moodle_section_info(match):
    label = clean_pdf_text(match.group(1) or match.group(2))
    folded = fold_ascii(label)
    if "serie de qi" in folded:
        return {"kind": "QI", "id": None, "format": None, "title": "Série de QI"}
    if folded.startswith("kfp"):
        number = re.search(r"\d+", folded)
        sid = f"kfp{number.group(0) if number else '1'}"
        return {"kind": "KFP", "id": sid, "format": "KFP", "title": label}
    number = re.search(r"\d+", folded)
    sid = f"dp{number.group(0) if number else '1'}"
    return {"kind": "DP", "id": sid, "format": "DP", "title": label}


def _moodle_extract_prelude_vignette(text_before):
    tail = clean_pdf_text(text_before[-1800:])
    matches = list(_MOODLE_CASE_START_RE.finditer(tail))
    if not matches:
        return None
    start = _moodle_case_cluster_start(matches)
    candidate = clean_pdf_text(tail[start:])
    if len(candidate) < 90:
        return None
    return candidate


def _moodle_case_cluster_start(matches):
    anchor = matches[-1]
    start = anchor.start()
    for match in reversed(matches[:-1]):
        if anchor.start() - match.start() > 420:
            break
        start = match.start()
    return start


def _moodle_split_trailing_vignette(block):
    """Retire une nouvelle vignette clinique collée à la fin du feedback.

    Les exports Moodle n'insèrent parfois aucun header entre la correction de la
    dernière question d'un cas et la vignette du cas suivant. Sans ce split, le
    prochain cas est bien détectable mais la correction précédente contient la
    vignette complète en suffixe.
    """
    text = clean_pdf_text(block)
    matches = list(_MOODLE_CASE_START_RE.finditer(text))
    if not matches:
        return block, None
    start = _moodle_case_cluster_start(matches)
    candidate = clean_pdf_text(text[start:])
    if len(candidate) < 90:
        return block, None
    before = text[:start]
    before_tail = fold_ascii(before[-1400:])
    if "feedback" not in before_tail:
        return block, None
    if (
        "la reponse correcte est" not in before_tail
        and "les reponses correctes sont" not in before_tail
    ):
        return block, None
    return clean_pdf_text(before), candidate


def _parse_moodle_correction_text(raw_text, meta, page_count):
    text = _moodle_compact_text(raw_text)
    question_events = []
    for match in _MOODLE_STATUS_RE.finditer(text):
        question_events.append({
            "kind": "question",
            "start": match.start(),
            "end": match.end(),
            "qnum": int(match.group(1)),
            "status": clean_pdf_text(match.group(2)),
            "synthetic": False,
        })

    section_events = []
    for match in _MOODLE_SECTION_RE.finditer(text):
        info = _moodle_section_info(match)
        section_events.append({
            "kind": "section",
            "start": match.start(),
            "end": match.end(),
            **info,
        })

    # Certains exports Moodle n'ont pas de header "Question 1 Correct" pour la
    # première QI/KFP : le bloc commence directement par "SERIE DE QI:" ou "KFP1:".
    for section in section_events:
        if section["kind"] not in {"QI", "KFP"}:
            continue
        next_question = next((q for q in question_events if q["start"] > section["start"]), None)
        search_end = next_question["start"] if next_question else len(text)
        segment = text[section["end"]:search_end]
        if re.search(r"\bQuestion\s+1\s+R[ée]ponse\b", segment, re.IGNORECASE):
            question_events.append({
                "kind": "question",
                "start": section["start"],
                "end": section["end"],
                "qnum": 1,
                "status": None,
                "synthetic": True,
                "section": section,
            })

    question_events.sort(key=lambda event: event["start"])
    all_events = sorted(section_events + question_events, key=lambda event: (event["start"], 0 if event["kind"] == "section" else 1))

    if len(question_events) < 5:
        raise RuntimeError("profil moodle/hypocampus non reconnu : questions insuffisantes")

    questions = []
    active_series = None
    previous_qnum = None
    implicit_counter = 0
    warnings = []

    def next_event_after(start):
        for event in all_events:
            if event["start"] > start:
                return event
        return None

    def next_event_start(start):
        event = next_event_after(start)
        return event["start"] if event else len(text)

    def headers_between(left, right):
        return [event for event in section_events if left < event["start"] <= right]

    previous_question_start = -1
    annale_slug = safe_slug(meta.get("id") or meta.get("title") or "annale", fallback="annale")

    for event in question_events:
        section_headers = headers_between(previous_question_start, event["start"])
        for section in section_headers:
            if section["kind"] == "QI":
                active_series = None
            elif section["kind"] in {"DP", "KFP"}:
                vignette = None
                if event["start"] > section["end"]:
                    vignette = clean_pdf_text(text[section["end"]:event["start"]]) or None
                active_series = {
                    "id": section["id"],
                    "format": section["format"],
                    "title": section["title"],
                    "vignette": vignette,
                }

        qnum = event["qnum"]
        if qnum == 1 and previous_qnum is not None and not section_headers and not event.get("synthetic"):
            vignette = _moodle_extract_prelude_vignette(text[:event["start"]])
            if vignette:
                implicit_counter += 1
                active_series = {
                    "id": f"moodle-dp-{annale_slug}-{implicit_counter}",
                    "format": "DP",
                    "title": "DP détecté",
                    "vignette": vignette,
                }
            else:
                active_series = None

        next_event = next_event_after(event["start"])
        end = next_event["start"] if next_event else len(text)
        block = text[event["end"]:end] if event.get("synthetic") else text[event["start"]:end]
        if event.get("synthetic"):
            block = text[event["end"]:end]
        if (
            next_event
            and next_event["kind"] == "question"
            and next_event.get("qnum") == 1
        ):
            block, _trailing_vignette = _moodle_split_trailing_vignette(block)
        question_text, answer_text, feedback_text = _moodle_question_text_from_block(
            block,
            qnum,
            synthetic=event.get("synthetic", False),
        )
        options = _moodle_parse_options(answer_text)
        correct_count, correct_text = _moodle_mark_correct_options(options, feedback_text)
        question_type = "QRM" if options else "QROC"
        question = {
            "id": f"q{len(questions) + 1}",
            "questionType": question_type,
            "text": question_text,
            "image": None,
            "correctionText": feedback_text,
            "seriesId": None,
            "seriesFormat": None,
            "seriesPosition": None,
            "seriesTotal": None,
            "vignette": None,
            "customTitle": None,
        }
        if options:
            question["options"] = options
            if correct_count == 0:
                warnings.append(f"{question['id']}: aucune bonne reponse extraite depuis le feedback")
        else:
            question["expectedAnswer"] = correct_text or clean_pdf_text(answer_text)
            if not question["expectedAnswer"]:
                warnings.append(f"{question['id']}: reponse attendue vide")

        if active_series:
            question.update({
                "seriesId": active_series["id"],
                "seriesFormat": active_series["format"],
                "customTitle": active_series["title"],
                "vignette": active_series.get("vignette") if qnum == 1 else None,
            })

        questions.append(question)
        previous_qnum = qnum
        previous_question_start = event["start"]

    groups = {}
    for question in questions:
        sid = question.get("seriesId")
        if sid:
            groups.setdefault(sid, []).append(question)
    for group in groups.values():
        total = len(group)
        for position, question in enumerate(group, start=1):
            question["seriesPosition"] = position
            question["seriesTotal"] = total

    shuffle_questions_options(questions)

    annale = {
        "id": meta["id"],
        "title": meta["title"],
        "subject": meta["subject"],
        "year": meta["year"],
        "session": meta.get("session") or None,
        "questions": questions,
    }
    report = {
        "profile": "moodle-hypocampus-correction",
        "pages": page_count,
        "textChars": len(raw_text or ""),
        "questionsDetected": len(questions),
        "series": [
            {
                "id": sid,
                "format": group[0].get("seriesFormat"),
                "title": group[0].get("customTitle"),
                "total": len(group),
            }
            for sid, group in sorted(groups.items())
        ],
        "qiCount": len([q for q in questions if not q.get("seriesId")]),
        "imagesAttached": 0,
        "warnings": warnings,
    }
    return annale, report, raw_text


def _parse_uness_items_to_annale(items, meta, page_count, raw_text):
    """Construit l'annale + report à partir d'items déjà extraits (texte/image).

    Séparé de parse_uness_correction_local pour permettre le test unitaire
    sans dépendance PyMuPDF/PDF binaire.

    `items` est une liste triée de dicts {kind, page, x0, y0, x1, y1, text, lines}
    pour les textes, ou {kind, page, x0..., width, height, ext, data} pour images.
    """

    def item_text(item):
        return item.get("text") or ""

    def is_marker(item):
        if item.get("kind") != "text":
            return False
        text = fold_ascii(item_text(item))
        return "question " in text and "question a reponse" in text

    def marker_number(item):
        nums = re.findall(r"question\s+(\d+)", fold_ascii(item_text(item)))
        return int(nums[-1]) if nums else None

    def marker_type(item):
        text = fold_ascii(item_text(item))
        if "ouverte et courte" in text:
            return "QROC"
        if "unique" in text:
            return "QRU"
        return "QRM"

    def is_series_header(item):
        if item.get("kind") != "text":
            return False
        text = fold_ascii(item_text(item))
        return bool(re.search(r"\bdp\s*\d+\b|\bdp\d+\b|\bkfp\s*\d*\b", text))

    def series_info(item):
        text = clean_pdf_text(item_text(item))
        folded = fold_ascii(text)
        fmt = "KFP" if "kfp" in folded or "element cle" in folded else "DP"
        if fmt == "DP":
            match = re.search(r"\bdp\s*(\d+)\b|\bdp(\d+)\b", folded)
        else:
            match = re.search(r"\bkfp\s*(\d+)\b|\bkfp(\d+)\b", folded)
        number = int((match.group(1) or match.group(2)) if match else 1)
        prefix = "kfp" if fmt == "KFP" else "dp"
        return {
            "id": f"{prefix}{number}",
            "format": fmt,
            "title": text,
            "vignetteParts": [],
        }

    def is_qi_header(item):
        return item.get("kind") == "text" and "questions isolees" in fold_ascii(item_text(item))

    def is_response_header(item):
        return item.get("kind") == "text" and "reponse attendue" in fold_ascii(item_text(item))

    def is_correction_header(item):
        return item.get("kind") == "text" and "commentaire de correction" in fold_ascii(item_text(item))

    def parse_option(item):
        if item.get("kind") != "text":
            return None
        lines = [line.strip() for line in item.get("lines") or [] if line.strip()]
        if len(lines) >= 3 and re.fullmatch(r"[A-E]", lines[0]) and lines[1] in ("☑", "■"):
            return {
                "id": lines[0],
                "text": clean_pdf_text(" ".join(lines[2:])),
                "correct": lines[1] == "☑",
            }
        match = re.match(r"^([A-E])\s*([☑■])\s+(.+)$", clean_pdf_text(item_text(item)))
        if match:
            return {
                "id": match.group(1),
                "text": match.group(3).strip(),
                "correct": match.group(2) == "☑",
            }
        return None

    def strip_correction(text):
        text = str(text or "").replace("", " ").strip()
        text = re.sub(r"^\s*Commentaire de correction de la question\s*", "", text, flags=re.I)
        text = re.sub(r"^\s*Commentaires\s*:?", "", text, flags=re.I)
        return clean_pdf_text(text)

    def dedupe_images(images):
        kept = []
        for image in sorted(images, key=lambda img: len(img.get("data") or b""), reverse=True):
            duplicate = False
            for other in kept:
                close = (
                    image["page"] == other["page"]
                    and abs(image["x0"] - other["x0"]) < 8
                    and abs(image["y0"] - other["y0"]) < 8
                    and abs(image["x1"] - other["x1"]) < 8
                    and abs(image["y1"] - other["y1"]) < 8
                )
                if close:
                    duplicate = True
                    break
            if not duplicate:
                kept.append(image)
        return sorted(kept, key=lambda img: (img["page"], img["y0"], img["x0"]))

    markers = [index for index, item in enumerate(items) if is_marker(item)]
    checkbox_count = sum(1 for item in items if item.get("kind") == "text" and ("☑" in item_text(item) or "■" in item_text(item)))
    if len(markers) < 5 or checkbox_count < 5:
        raise RuntimeError("profil non reconnu : PDF de correction UNESS avec cases cochees attendu")

    # ────────────────────────────────────────────────────────────────
    # Helpers pour la détection de vignettes IMPLICITES
    # ────────────────────────────────────────────────────────────────

    def collect_pre_marker_paragraphs(start_index, end_index):
        """Collecte les blocs texte 'libres' entre start_index et end_index
        (exclu) qui sont des candidats à former une vignette implicite.

        Exclut : marqueurs question, headers série/QI, headers réponse/correction,
        options A-E, images, et indications de pagination déjà filtrées.
        """
        parts = []
        for item in items[start_index:end_index]:
            if item.get("kind") != "text":
                continue
            if is_marker(item) or is_series_header(item) or is_qi_header(item):
                continue
            if is_response_header(item) or is_correction_header(item):
                continue
            if parse_option(item):
                continue
            text = clean_pdf_text(item_text(item))
            if not text:
                continue
            parts.append(text)
        return parts

    def looks_like_implicit_vignette(paragraph_text):
        """Vrai si le texte ressemble à une vignette clinique introductive
        sans header DP/KFP explicite : patient marker + verbe d'admission +
        longueur substantielle (≥150 chars)."""
        if not paragraph_text or len(paragraph_text) < 150:
            return False
        if not _PATIENT_MARKER_RE.search(paragraph_text):
            return False
        if not _ADMISSION_VERB_RE.search(paragraph_text):
            return False
        return True

    def question_has_patient_reference(question_text):
        """Vrai si le texte de la question référence explicitement le patient
        ('Madame X', 'cette patiente', 'chez le patient', etc.)."""
        if not question_text:
            return False
        return bool(_PATIENT_REFERENCE_RE.search(question_text))

    def extract_patient_label(paragraph_text):
        """Extrait un label court 'Mme Léa', 'Monsieur X', ... pour le
        customTitle de la série virtuelle. Retourne None si rien de probant."""
        if not paragraph_text:
            return None
        match = _PATIENT_LABEL_RE.search(paragraph_text)
        if match:
            return match.group(0).strip()
        return None

    def collect_question_text_preview(item_index, next_marker_index):
        """Concatène les blocs texte de la question (segment) hors options,
        headers et correction, pour pouvoir tester la présence d'une
        référence nominale. Lookahead seulement, ne modifie rien."""
        parts = []
        mode = "pre"
        end = next_marker_index if next_marker_index is not None else len(items)
        for item in items[item_index + 1:end]:
            if is_series_header(item) or is_qi_header(item):
                break
            if item.get("kind") != "text":
                continue
            if parse_option(item):
                mode = "options"
                continue
            if is_response_header(item):
                mode = "expected"
                continue
            if is_correction_header(item):
                mode = "correction"
                continue
            if mode == "pre":
                parts.append(clean_pdf_text(item_text(item)))
        return " ".join(p for p in parts if p)

    # Pré-calcule pour chaque marker si une série implicite doit y commencer.
    # Heuristique : marker_number == 1, pas de pending_series détecté lors du
    # scan précédent, paragraphe vignette substantiel juste avant, et au moins
    # une des deux questions suivantes contient une référence nominale.
    implicit_series_starts = {}  # marker_index -> {"vignette", "label", "id"}
    implicit_series_marker_set = set()  # set des marker_index inclus dans une série implicite
    implicit_series_groups = []  # liste des marker_indices par série implicite

    # On simule le scan séquentiel pour ne déclencher l'implicite que quand
    # aucun header explicite (DP/KFP) n'est en pending au moment du marker.
    _scan_pending_series = None
    _scan_pending_qi = False
    _scan_previous = 0
    _implicit_counter = 0
    annale_slug = safe_slug(meta.get("id") or meta.get("title") or "annale", fallback="annale")

    for _mi, _ii in enumerate(markers):
        for _it in items[_scan_previous:_ii]:
            if is_series_header(_it):
                _scan_pending_series = True
                _scan_pending_qi = False
            elif is_qi_header(_it):
                _scan_pending_qi = True
                _scan_pending_series = None

        _number = marker_number(items[_ii])
        _qcm_no_pending = _scan_pending_series is None and not _scan_pending_qi
        # On déclenche uniquement sur Q1 (start de potentielle série)
        if _number == 1 and _qcm_no_pending:
            paragraphs = collect_pre_marker_paragraphs(_scan_previous, _ii)
            joined = " ".join(paragraphs).strip()
            joined = clean_pdf_text(joined)
            if looks_like_implicit_vignette(joined):
                # Vérifier la référence nominale dans Q1 et/ou Q2
                next_marker_pos = markers[_mi + 1] if _mi + 1 < len(markers) else None
                q1_text = collect_question_text_preview(_ii, next_marker_pos)
                q2_text = ""
                if _mi + 1 < len(markers):
                    next2 = markers[_mi + 2] if _mi + 2 < len(markers) else None
                    q2_text = collect_question_text_preview(markers[_mi + 1], next2)
                if (
                    question_has_patient_reference(q1_text)
                    or question_has_patient_reference(q2_text)
                ):
                    _implicit_counter += 1
                    label = extract_patient_label(joined)
                    short_title = label or " ".join(joined.split()[:5])
                    custom_title = "Cas — " + short_title if short_title else "Cas implicite"
                    series_id = f"implicit-{annale_slug}-{_implicit_counter}"
                    implicit_series_starts[_mi] = {
                        "vignette": joined,
                        "label": label,
                        "id": series_id,
                        "title": custom_title,
                    }
                    # Détermine la portée de la série : Q1 + questions consécutives
                    # qui ont aussi une référence nominale (au moins une).
                    # Si la question suivante a un changement de patient (autre
                    # nom détecté différent du label), on stoppe.
                    members = [_mi]
                    label_folded = fold_ascii(label) if label else None
                    last_question_index = _mi
                    _look = _mi + 1
                    while _look < len(markers):
                        # Stop si nouvelle série explicite démarre dans
                        # l'intervalle entre cette question précédente et celle-ci
                        _interval_start = markers[_look - 1] + 1
                        _interval_end = markers[_look]
                        explicit_break = any(
                            is_series_header(it) or is_qi_header(it)
                            for it in items[_interval_start:_interval_end]
                        )
                        if explicit_break:
                            break
                        next_marker_pos2 = (
                            markers[_look + 1] if _look + 1 < len(markers) else None
                        )
                        qn_text = collect_question_text_preview(markers[_look], next_marker_pos2)
                        qn_text_folded = fold_ascii(qn_text)
                        # Si nouveau marker_number == 1 et qu'on est déjà dans une
                        # série, c'est suspect : on stoppe.
                        if marker_number(items[markers[_look]]) == 1:
                            break
                        if not question_has_patient_reference(qn_text):
                            break
                        # Changement de patient ? Si label connu et qn_text mentionne
                        # un autre label de type "Madame/Monsieur Z" distinct, stop.
                        other_label = extract_patient_label(qn_text)
                        if (
                            label_folded
                            and other_label
                            and fold_ascii(other_label) != label_folded
                        ):
                            break
                        members.append(_look)
                        last_question_index = _look
                        _look += 1
                    for m in members:
                        implicit_series_marker_set.add(m)
                    implicit_series_groups.append(
                        {"id": series_id, "title": custom_title, "members": members}
                    )

        # Simulation des transitions (pour les markers suivants).
        if _scan_pending_qi and _number == 1:
            _scan_pending_qi = False
        if _scan_pending_series and _number == 1:
            _scan_pending_series = None
        _scan_previous = _ii + 1

    # Map : marker_index -> (series_id, position dans la série, total série)
    implicit_member_info = {}
    for group in implicit_series_groups:
        total = len(group["members"])
        for position, mi in enumerate(group["members"], start=1):
            implicit_member_info[mi] = {
                "id": group["id"],
                "position": position,
                "total": total,
                "title": group["title"],
            }

    current_series = None
    pending_series = None
    pending_qi = False
    previous_scan = 0
    questions = []

    for marker_index, item_index in enumerate(markers):
        marker = items[item_index]
        number = marker_number(marker)

        for item in items[previous_scan:item_index]:
            if is_series_header(item):
                pending_series = series_info(item)
                pending_qi = False
            elif is_qi_header(item):
                pending_qi = True
                pending_series = None
            elif pending_series and item.get("kind") == "text" and not is_marker(item) and not is_response_header(item) and not is_correction_header(item):
                pending_series["vignetteParts"].append(clean_pdf_text(item_text(item)))

        if pending_qi and number == 1:
            current_series = None
            pending_qi = False
        if pending_series and number == 1:
            pending_series["vignette"] = clean_pdf_text(" ".join(pending_series["vignetteParts"]))
            current_series = pending_series
            pending_series = None
        # Détection d'une série implicite (sans header DP/KFP) :
        # on entre dans la série si ce marker est le Q1 d'une série virtuelle.
        if marker_index in implicit_series_starts and current_series is None:
            info = implicit_series_starts[marker_index]
            current_series = {
                "id": info["id"],
                "format": "DP",
                "title": info["title"],
                "vignette": info["vignette"],
                "_implicit": True,
            }
        # Sortie automatique de la série implicite : si on n'est pas membre de
        # cette série implicite, on bascule en hors-série.
        if (
            current_series is not None
            and current_series.get("_implicit")
            and marker_index not in implicit_series_marker_set
        ):
            current_series = None

        next_index = markers[marker_index + 1] if marker_index + 1 < len(markers) else len(items)
        segment = []
        for item in items[item_index + 1:next_index]:
            if is_series_header(item) or is_qi_header(item):
                break
            segment.append(item)

        text_parts = []
        options = []
        expected_parts = []
        correction_parts = []
        images = []
        mode = "pre"

        for item in segment:
            if item.get("kind") == "image":
                images.append(item)
                continue
            option = parse_option(item)
            if option:
                options.append(option)
                mode = "options"
                continue
            if is_response_header(item):
                mode = "expected"
                continue
            if is_correction_header(item):
                correction = strip_correction(item_text(item))
                if correction:
                    correction_parts.append(correction)
                mode = "correction"
                continue
            if mode == "pre":
                text_parts.append(clean_pdf_text(item_text(item)))
            elif mode == "expected":
                expected_parts.append(clean_pdf_text(item_text(item)))
            elif mode == "correction":
                correction_parts.append(clean_pdf_text(item_text(item)))

        question_type = marker_type(marker)
        question = {
            "id": f"q{len(questions) + 1}",
            "questionType": question_type,
            "text": clean_pdf_text(" ".join(text_parts)),
            "image": None,
            "correctionText": clean_pdf_text(" ".join(correction_parts)),
        }
        if options:
            question["options"] = options
        if question_type == "QROC":
            question["expectedAnswer"] = "\n".join(part for part in expected_parts if part)
        if current_series:
            is_implicit = bool(current_series.get("_implicit"))
            # Sur une série implicite, on n'attache la vignette qu'à Q1.
            vignette_value = current_series.get("vignette") or None
            if is_implicit and marker_index in implicit_member_info:
                if implicit_member_info[marker_index]["position"] != 1:
                    vignette_value = None
            question.update({
                "seriesId": current_series["id"],
                "seriesFormat": current_series["format"],
                "seriesPosition": None,
                "seriesTotal": None,
                "vignette": vignette_value,
                "customTitle": current_series["title"],
            })
            if is_implicit:
                question.setdefault("warnings", []).append({
                    "code": "implicit-series-detected",
                    "severity": "info",
                    "message": (
                        "Série DP détectée implicitement (sans header DP/KFP "
                        "dans le PDF). Vérifier la vignette et le regroupement."
                    ),
                })
        else:
            question.update({
                "seriesId": None,
                "seriesFormat": None,
                "seriesPosition": None,
                "seriesTotal": None,
                "vignette": None,
                "customTitle": None,
            })

        usable_images = dedupe_images(images)
        if usable_images:
            question["_imagesToWrite"] = usable_images[:1]
            ext = safe_filename(usable_images[0].get("ext")) or "png"
            question["image"] = f"{question['id']}.{ext}"

        questions.append(question)
        previous_scan = item_index + 1

    groups = {}
    for question in questions:
        sid = question.get("seriesId")
        if sid:
            groups.setdefault(sid, []).append(question)
    for group in groups.values():
        total = len(group)
        for position, question in enumerate(group, start=1):
            question["seriesPosition"] = position
            question["seriesTotal"] = total

    # Anti-biais : DeepSeek + extracteurs PDF placent souvent les bonnes
    # réponses en début. Shuffle aléatoire avec réassignation A→E.
    shuffle_questions_options(questions)

    warnings = []
    for question in questions:
        if not question.get("text"):
            warnings.append(f"{question['id']}: enonce vide")
        if question.get("questionType") in ("QRU", "QRM"):
            correct_count = sum(1 for option in question.get("options") or [] if option.get("correct"))
            if correct_count == 0:
                warnings.append(f"{question['id']}: QCM sans bonne reponse")
            if question.get("questionType") == "QRU" and correct_count != 1:
                warnings.append(f"{question['id']}: QRU avec {correct_count} bonnes reponses")
        if not question.get("correctionText"):
            warnings.append(f"{question['id']}: correction detaillee vide")

    annale = {
        "id": meta["id"],
        "title": meta["title"],
        "subject": meta["subject"],
        "year": meta["year"],
        "session": meta.get("session") or None,
        "questions": questions,
    }
    series_report = [
        {
            "id": sid,
            "format": group[0].get("seriesFormat"),
            "title": group[0].get("customTitle"),
            "total": len(group),
        }
        for sid, group in sorted(groups.items())
    ]
    report = {
        "profile": "uness-correction-layout",
        "pages": page_count,
        "textChars": len(raw_text or ""),
        "questionsDetected": len(questions),
        "series": series_report,
        "qiCount": len([q for q in questions if not q.get("seriesId")]),
        "imagesAttached": len([q for q in questions if q.get("image")]),
        "warnings": warnings,
    }
    return annale, report, raw_text


# ────────────────────────────────────────────────────────────────────
# Écriture des images d'une annale sur disque
# ────────────────────────────────────────────────────────────────────


def write_annale_images(annale, images_dir):
    """
    Écrit les images attachées aux questions d'une annale dans `images_dir`.
    Consomme et supprime le champ `_imagesToWrite` de chaque question.
    Retourne le nombre d'images effectivement écrites.
    """
    os.makedirs(images_dir, exist_ok=True)
    written = 0
    for question in annale.get("questions") or []:
        pending = question.pop("_imagesToWrite", None) or []
        for index, image in enumerate(pending):
            filename = question.get("image")
            if index > 0:
                base, ext = os.path.splitext(filename or f"{question['id']}.png")
                filename = f"{base}-{index + 1}{ext or '.png'}"
            filename = safe_filename(filename)
            if not filename:
                continue
            with open(os.path.join(images_dir, filename), "wb") as fh:
                fh.write(image.get("data") or b"")
            written += 1
    return written
