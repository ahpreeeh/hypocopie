"""
core.options — Utilitaires de manipulation des options de questions QRU/QRM.

Objet : éviter le biais de position où les LLM/PDFs placent souvent les
bonnes réponses en début de liste (78% des QRU en position A dans le corpus
actuel). Le shuffle se fait à la création de l'annale (parsing UNESS ou
génération QROC), avec réassignation des ids A, B, C... selon le nouvel ordre.
"""

from __future__ import annotations

import random
from typing import Any

# Lettres utilisées comme id d'options. Les QRM EDN-like peuvent monter
# jusqu'à 15 propositions.
OPTION_LETTERS = "ABCDEFGHIJKLMNO"


def _reassign_option_ids(options: list[dict[str, Any]]) -> None:
    for i, opt in enumerate(options):
        if i < len(OPTION_LETTERS):
            opt["id"] = OPTION_LETTERS[i]
        else:
            opt["id"] = f"O{i + 1}"


def _place_first_correct_at(options: list[dict[str, Any]], target_index: int) -> list[dict[str, Any]]:
    """Place the first correct answer near target_index when the option set allows it."""
    correct = [o for o in options if o.get("correct")]
    incorrect = [o for o in options if not o.get("correct")]
    if not correct or not incorrect:
        return options
    target_index = max(0, min(target_index, len(options) - 1, len(incorrect)))
    return incorrect[:target_index] + correct[:1] + incorrect[target_index:] + correct[1:]


def shuffle_question_options(
    question: dict[str, Any],
    rng: random.Random | None = None,
    first_correct_target: int | None = None,
) -> dict[str, Any]:
    """
    Mélange l'ordre des options d'une question in-place et réassigne les ids
    selon le nouvel ordre (A, B, C...). Retourne la question modifiée (pour
    chaînage / fluent).

    No-op si :
    - pas de champ "options"
    - options n'est pas une liste
    - moins de 2 options (rien à mélanger)
    - une option n'est pas un dict

    Le shuffle est aléatoire par défaut. Pour reproductibilité (tests), passer
    `rng=random.Random(seed)`.
    """
    opts = question.get("options")
    if not isinstance(opts, list) or len(opts) < 2:
        return question
    if not all(isinstance(o, dict) for o in opts):
        return question

    if rng is None:
        random.shuffle(opts)
    else:
        rng.shuffle(opts)

    if first_correct_target is not None:
        opts = _place_first_correct_at(opts, first_correct_target)

    _reassign_option_ids(opts)

    question["options"] = opts
    return question


def shuffle_questions_options(questions: list[dict[str, Any]], rng: random.Random | None = None) -> int:
    """
    Mélange les options de toutes les questions d'une liste in-place.
    Retourne le nombre de questions effectivement mélangées (≥ 2 options).

    Pratique pour appel global après assemblage d'une annale entière.
    """
    n = 0
    for q in questions:
        before = q.get("options")
        if isinstance(before, list) and len(before) >= 2:
            target_index = n % len(before)
            shuffle_question_options(q, rng=rng, first_correct_target=target_index)
            n += 1
    return n


def measure_position_bias(questions: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Calcule des stats de biais de position sur une liste de questions.
    Utilisé par les outils de diagnostic (script tools/shuffle_options.py)
    pour identifier les annales à rectifier.

    Retourne :
        {
            "totalWithOptions": int,
            "firstCorrectAtA": int,          # 1ère bonne réponse en pos 0
            "firstCorrectAtARatio": float,   # ratio (0..1)
            "positionDistribution": {0: N, 1: N, ...},
            "qrmFirstNAllCorrect": {2: N, 3: N, 4: N, 5: N},  # combien ont les N premières toutes correctes
        }
    """
    total = 0
    first_at_a = 0
    position_dist: dict[int, int] = {}
    qrm_first_n: dict[int, int] = {2: 0, 3: 0, 4: 0, 5: 0}
    for q in questions:
        opts = q.get("options") or []
        if not isinstance(opts, list) or not opts:
            continue
        total += 1
        # Position de la première bonne réponse
        first_pos = None
        for i, o in enumerate(opts):
            if isinstance(o, dict) and o.get("correct"):
                first_pos = i
                break
        if first_pos is not None:
            position_dist[first_pos] = position_dist.get(first_pos, 0) + 1
            if first_pos == 0:
                first_at_a += 1
        # Pour QRM : nb d'options correctes consécutives au début
        ncorrect = sum(1 for o in opts if isinstance(o, dict) and o.get("correct"))
        if ncorrect >= 2:
            consec = 0
            for o in opts:
                if isinstance(o, dict) and o.get("correct"):
                    consec += 1
                else:
                    break
            for thresh in (2, 3, 4, 5):
                if consec >= thresh:
                    qrm_first_n[thresh] += 1
    return {
        "totalWithOptions": total,
        "firstCorrectAtA": first_at_a,
        "firstCorrectAtARatio": (first_at_a / total) if total else 0.0,
        "positionDistribution": dict(sorted(position_dist.items())),
        "qrmFirstNAllCorrect": qrm_first_n,
    }
