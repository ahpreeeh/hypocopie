"""
core.text_utils — Helpers de normalisation texte + sévérité warnings.

Module zéro-dépendance. Tout ce qui transforme du texte (ASCII fold, nettoyage
PDF) ou classifie une sévérité de warning est centralisé ici.

Issu de Phase 1 de la modularisation.
"""

import re
import unicodedata

from .storage import safe_slug


# ────────────────────────────────────────────────────────────────────
# Normalisation texte
# ────────────────────────────────────────────────────────────────────


def fold_ascii(value):
    """
    Normalise une chaîne en ASCII lowercase (sans accents).
    Utile pour les comparaisons insensibles à la casse/diacritiques.
    """
    value = unicodedata.normalize("NFKD", str(value or ""))
    return value.encode("ascii", "ignore").decode("ascii").lower()


def clean_pdf_text(value):
    """
    Nettoie un fragment de texte extrait d'un PDF :
    - Remplace les glyphes UNESS spécifiques (, ) par des espaces.
    - Compresse les whitespaces en un seul espace.
    - Strip.
    """
    value = str(value or "").replace("", " ").replace("", " ")
    return re.sub(r"\s+", " ", value).strip()


# ────────────────────────────────────────────────────────────────────
# Conversion safe
# ────────────────────────────────────────────────────────────────────


def int_or_none(value):
    """
    Tente une conversion en int. Retourne None si impossible OU si la valeur est 0.
    Convention utilisée historiquement dans le projet : "valeur absente" ≡ None ≡ 0.
    """
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed or None


def normalize_question_id(value, index):
    """
    Normalise un identifiant de question : conserve tel quel si déjà valide,
    sinon slugifie. Fallback `qN+1` en dernier recours.
    """
    fallback = f"q{index + 1}"
    value = str(value or fallback).strip()
    if re.match(r"^[A-Za-z0-9_\-]{1,80}$", value):
        return value
    return safe_slug(value, fallback=fallback)


# ────────────────────────────────────────────────────────────────────
# Sévérité warnings (utilisée par les validators de blocs sources QROC)
# ────────────────────────────────────────────────────────────────────


def qroc_source_warning(code, message, blocking=False, severity=None):
    """
    Construit un warning structuré pour un bloc source QROC.

    Severity :
    - 'error' : bloque la publication
    - 'warning' : à vérifier mais publishable
    - 'info' : cosmétique, masqué par défaut dans l'UI

    Si non fourni, la sévérité est déduite du flag `blocking` pour rétrocompat.
    """
    if severity is None:
        severity = "error" if blocking else "warning"
    return {
        "code": code,
        "message": message,
        "blocking": bool(blocking),
        "severity": severity,
    }


def is_blocking_severity(severity):
    """Une seule sévérité bloque le publish : 'error'."""
    return severity == "error"
