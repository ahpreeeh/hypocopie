"""
core.qroc_blocks — Validation et stats des blocs source QROC extraits du PDF.

Ces fonctions analysent un bloc textuel (issu du parser PDF) pour :
- calculer ses statistiques (chars, markers d'instruction, lignes de réponse)
- détecter les blocs problématiques (trop courts, trop longs, bruyants)
- générer des warnings avec sévérité (error/warning/info)

Module zéro-dépendance vers server.py.
"""

import re

from .text_utils import clean_pdf_text, fold_ascii, qroc_source_warning


def source_block_stats(text):
    """
    Calcule les statistiques d'un bloc texte source.
    - chars : nombre de caractères après cleanup
    - questionMarkers : occurrences de "Question N", "N." ou "N)" (indicateurs de sous-questions)
    - instructionMarkers : verbes d'instruction médicaux ("citer", "donner", "quel(s)", "diagnostic", etc.)
    - answerLines : lignes de plus de 3 caractères (= probablement du contenu utile)
    """
    clean = clean_pdf_text(text)
    folded = fold_ascii(clean)
    instruction_pattern = (
        r"\b("
        r"citez?|citer|donnez?|nommez?|indiquez?|precisez?|enumerez?|listez?|"
        r"quel(?:le|les|s)?|quels?|quelle|quelles|"
        r"diagnostic|traitement|prise\s+en\s+charge|facteurs?|arguments?|examens?|signes?"
        r")\b"
    )
    return {
        "chars": len(clean),
        "questionMarkers": len(re.findall(r"\b(?:question\s*)?\d+\s*[\).]", folded)),
        "instructionMarkers": len(re.findall(instruction_pattern, folded)),
        "answerLines": len([line for line in str(text or "").splitlines() if len(line.strip()) >= 3]),
    }


def validate_source_block(block):
    """
    Annote un bloc source avec ses stats et ses warnings (sévérité).
    Modifie `block` en place (champs `stats` et `warnings` ajoutés) ET le retourne.

    Règles de sévérité :
    - chars < 120 : error
    - 120 ≤ chars < 350 sans markers d'instruction : error, sinon warning
    - chars > 12000 : error
    - questionMarkers == 0 sans markers d'instruction : error, sinon info
    - useful_ratio < 0.35 (bloc bruyant) : error

    Si `block.warningsOverride == "accepted"`, toutes les erreurs sont downgradées
    en warning (visible mais non-bloquant) et marquées `accepted: true`.
    """
    text = block.get("cleanText") or block.get("rawText") or ""
    stats = source_block_stats(text)
    warnings = []
    has_instruction = stats["instructionMarkers"] > 0
    has_content_lines = stats["answerLines"] >= 2
    if stats["chars"] < 120:
        warnings.append(qroc_source_warning("short-block", "Bloc tres court : verifier le decoupage.", True, severity="error"))
    elif stats["chars"] < 350:
        block_short = not (has_instruction and has_content_lines)
        warnings.append(qroc_source_warning(
            "short-block",
            "Bloc tres court : verifier le decoupage.",
            block_short,
            severity="error" if block_short else "warning",
        ))
    if stats["chars"] > 12000:
        warnings.append(qroc_source_warning("long-block", "Bloc tres long : scinder avant generation.", True, severity="error"))
    if stats["questionMarkers"] == 0:
        no_marker_block = not has_instruction
        warnings.append(qroc_source_warning(
            "no-question-marker",
            "Aucune sous-question numerotee detectee.",
            no_marker_block,
            severity="error" if no_marker_block else "info",
        ))
    useful_ratio = len(re.sub(r"[^A-Za-z0-9À-ÿ]", "", text)) / max(1, len(text))
    if useful_ratio < 0.35:
        warnings.append(qroc_source_warning("noisy-block", "Bloc bruite : nettoyer le texte source.", True, severity="error"))
    if block.get("warningsOverride") == "accepted":
        for warning in warnings:
            warning["blocking"] = False
            warning["accepted"] = True
            # Downgrade des erreurs acceptées manuellement en warning (toujours visibles, non bloquantes)
            if warning.get("severity") == "error":
                warning["severity"] = "warning"
    block["stats"] = stats
    block["warnings"] = warnings
    return block


def is_qroc_block_start(line):
    """
    Détecte si une ligne est probablement le début d'un bloc QROC.
    Patterns : "QROC N", "Dossier N", "Cas N" (en début de ligne, insensible à la casse).
    """
    folded = fold_ascii(line)
    if re.match(r"^\s*qroc\s*\d+\b", folded):
        return True
    if re.match(r"^\s*(dossier|cas)\s+\d+\b", folded):
        return True
    return False


def is_generic_question_start(line):
    """
    Détecte un début de question GÉNÉRIQUE (profil 'faithful', PDF non-QROC/non-UNESS).

    Plus permissif que is_qroc_block_start : couvre les énumérations numérotées et les
    en-têtes de question courants des sujets d'examen, en plus des marqueurs QROC.
    Patterns : "1.", "2)", "Question N", "Q1", "Exercice N", "QCM N", "QRU/QRM N",
    "Item N", "Cas clinique N", "Énoncé N".
    """
    folded = fold_ascii(line).strip()
    if not folded:
        return False
    # Numérotation simple en début de ligne : "12." ou "3)"
    if re.match(r"^\d{1,3}\s*[\).]", folded):
        return True
    # En-têtes textuels de question
    if re.match(r"^(question|q|exercice|qcm|qru|qrm|item|cas\s+clinique|enonce)\s*n?[°o]?\s*\d+\b", folded):
        return True
    return is_qroc_block_start(line)
