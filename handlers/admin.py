"""
handlers.admin — Endpoints administratifs (backup, health, dedupe-scan).

Routes gérées :
- GET  /api/admin/backups
- POST /api/admin/backup
- DELETE /api/admin/backups/<filename>
- GET  /api/admin/orphan-vignettes
"""

import json
import os
import re
import sys


# Pattern de détection des questions qui font référence à un patient/vignette
# sans qu'aucune vignette clinique ne soit attachée à la série.
# Couverture : "Madame X", "Mme", "Monsieur", "Mr.", "M. ", "cette patiente",
# "ce patient", "chez le patient", "chez la patiente"...
PATTERN_ORPHAN = re.compile(
    r"\b(madame|mme|monsieur|mr\.?|m\.\s)\b|cette patient[e]?|ce patient|chez (le|la) patient[e]?",
    re.IGNORECASE,
)


def handle_backups_list(handler, backup_manager):
    """GET /api/admin/backups — liste des backups disponibles."""
    handler._send_json(200, {
        "backups": backup_manager.list_backups(),
        "retentionCount": backup_manager.retention,
    })


def handle_backup_create(handler, backup_manager, audit_log):
    """POST /api/admin/backup — crée un nouveau zip horodaté."""
    try:
        info = backup_manager.create()
    except Exception as e:
        handler._send_error(500, f"backup echoue : {e}")
        return
    audit_log("backup_created", {
        "filename": info["filename"],
        "sizeBytes": info["sizeBytes"],
    })
    handler._send_json(200, info)


def handle_backup_delete(handler, backup_manager, audit_log, filename):
    """DELETE /api/admin/backups/<filename> — supprime un backup."""
    if not backup_manager.delete(filename):
        handler._send_error(404, "backup inconnu ou nom invalide")
        return
    audit_log("delete_backup", {"filename": filename})
    handler._send_json(200, {"deleted": True, "filename": filename})


def handle_health(handler, captures_dir):
    """GET /api/health — ping de connectivité + compteur captures."""
    try:
        count = len(os.listdir(captures_dir))
    except OSError:
        count = 0
    handler._send_json(200, {"ok": True, "captures": count})


def handle_dedupe_scan(handler, captures_dir, compute_content_signature):
    """GET /api/dedupe-scan — scan disque pour détecter les doublons captures."""
    groups_by_content = {}
    try:
        for name in os.listdir(captures_dir):
            if not (name.startswith("q_") and name.endswith(".json")):
                continue
            try:
                with open(os.path.join(captures_dir, name), "r", encoding="utf-8") as fh:
                    q = json.load(fh)
                c_sig = compute_content_signature(q)
                groups_by_content.setdefault(c_sig, []).append({
                    "id": q.get("id"),
                    "questionText": (q.get("questionText") or "")[:200],
                    "format": q.get("format"),
                    "subject": q.get("subject"),
                    "url": q.get("url"),
                    "createdAt": q.get("createdAt"),
                    "seenAgainCount": len(q.get("seenAgain") or []),
                })
            except (OSError, json.JSONDecodeError) as e:
                print(f"[warn] dedupe-scan: {name} {e}", file=sys.stderr)
    except FileNotFoundError:
        pass
    duplicates = [
        {"contentSig": sig[:16], "entries": entries}
        for sig, entries in groups_by_content.items()
        if len(entries) >= 2
    ]
    handler._send_json(200, {"groups": duplicates, "totalGroups": len(duplicates)})


# ────────────────────────────────────────────────────────────────────
# Diagnostic vignettes orphelines (C1)
# ────────────────────────────────────────────────────────────────────


def _series_has_any_vignette(annale, series_id):
    """Renvoie True si au moins une question de la même série porte une vignette non vide."""
    if not series_id:
        return False
    for q in annale.get("questions") or []:
        if not isinstance(q, dict):
            continue
        if q.get("seriesId") != series_id:
            continue
        vignette = q.get("vignette")
        if isinstance(vignette, str) and vignette.strip():
            return True
    return False


def _detect_orphan_pattern(text):
    """Renvoie le match littéral du pattern orphan dans `text`, sinon None."""
    if not isinstance(text, str) or not text:
        return None
    match = PATTERN_ORPHAN.search(text)
    return match.group(0) if match else None


def _classify_source(annale):
    """
    Heuristique source d'origine :
    - 'qroc' si meta `draftSource` est défini, OU si l'id se termine par '-N'
      (suffixe de re-génération QROC), p.ex. neurologie-2021-s2-2.
    - 'pdf' sinon.
    """
    meta = annale.get("meta")
    if isinstance(meta, dict) and meta.get("draftSource"):
        return "qroc"
    if annale.get("draftSource"):
        return "qroc"
    aid = annale.get("id") or ""
    if re.search(r"-\d+$", aid):
        return "qroc"
    return "pdf"


def count_orphan_questions(annales_cache):
    """
    Compte rapide des questions orphelines (mention patient sans vignette
    visible dans leur série). Utilisé par le badge NavTile via
    /api/reports/summary. Ne fait pas le rapport détaillé, juste le count.
    """
    if not isinstance(annales_cache, dict):
        return 0
    count = 0
    for annale in annales_cache.values():
        if not isinstance(annale, dict):
            continue
        questions = annale.get("questions") or []
        if not isinstance(questions, list):
            continue
        series_vignette_cache = {}
        for q in questions:
            if not isinstance(q, dict):
                continue
            text = q.get("text") or ""
            correction_text = q.get("correctionText") or ""
            matched = _detect_orphan_pattern(text) or _detect_orphan_pattern(correction_text)
            if not matched:
                continue
            series_id = q.get("seriesId") or None
            if series_id:
                if series_id not in series_vignette_cache:
                    series_vignette_cache[series_id] = _series_has_any_vignette(annale, series_id)
                if series_vignette_cache[series_id]:
                    continue
            count += 1
    return count


def handle_admin_question_detail(handler, annales_cache, aid, qid):
    """
    GET /api/admin/annales/<aid>/questions/<qid> — détail RAW d'une question
    (avec `correct`, `correctionText`, `expectedAnswer`) pour usage admin
    (édition via QuestionEditorModal).

    Cette route est local-only (server.py bind 127.0.0.1 uniquement). Pas
    d'auth ajoutée car l'app n'a pas de notion d'utilisateur — la sécurité
    repose sur l'isolation réseau.
    """
    annale = annales_cache.get(aid) if isinstance(annales_cache, dict) else None
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    target = None
    for q in (annale.get("questions") or []):
        if isinstance(q, dict) and q.get("id") == qid:
            target = q
            break
    if not target:
        handler._send_error(404, f"question inconnue dans cette annale : {qid}")
        return
    handler._send_json(200, {
        "annaleId": aid,
        "annaleTitle": annale.get("title"),
        "question": target,
    })


def handle_orphan_vignettes(handler, annales_cache):
    """
    GET /api/admin/orphan-vignettes — diagnostic des questions qui mentionnent
    un patient/Mme/M. X sans qu'aucune vignette clinique ne soit visible côté joueur.

    Itère sur le cache `annales_cache` (dict id→annale). Aucune relecture disque.
    Trie les annales par taux de questions problématiques décroissant.
    """
    annales_data = annales_cache.values() if isinstance(annales_cache, dict) else list(annales_cache)

    total_annales = 0
    total_questions = 0
    total_problematic = 0
    affected_annales = 0
    annales_report = []

    for annale in annales_data:
        if not isinstance(annale, dict):
            continue
        total_annales += 1
        questions = annale.get("questions") or []
        if not isinstance(questions, list):
            questions = []

        annale_total = len(questions)
        total_questions += annale_total

        problematic_questions = []

        # Cache local par seriesId : a-t-on déjà résolu si la série porte une vignette ?
        series_vignette_cache = {}

        for q in questions:
            if not isinstance(q, dict):
                continue
            text = q.get("text") or ""
            correction_text = q.get("correctionText") or ""

            matched = _detect_orphan_pattern(text) or _detect_orphan_pattern(correction_text)
            if not matched:
                continue

            series_id = q.get("seriesId") or None
            has_vignette_in_series = False
            if series_id:
                if series_id not in series_vignette_cache:
                    series_vignette_cache[series_id] = _series_has_any_vignette(annale, series_id)
                has_vignette_in_series = series_vignette_cache[series_id]

            # Critère : pas de seriesId OU série sans aucune vignette non-vide
            if series_id and has_vignette_in_series:
                continue

            excerpt = (text or "")[:100]
            problematic_questions.append({
                "id": q.get("id"),
                "pattern": matched,
                "textExcerpt": excerpt,
            })

        problematic_count = len(problematic_questions)
        total_problematic += problematic_count

        if problematic_count == 0:
            continue

        affected_annales += 1
        rate = (problematic_count / annale_total) if annale_total > 0 else 0.0

        annales_report.append({
            "id": annale.get("id"),
            "title": annale.get("title"),
            "subject": annale.get("subject"),
            "year": annale.get("year"),
            "session": annale.get("session"),
            "source": _classify_source(annale),
            "totalQuestions": annale_total,
            "problematicCount": problematic_count,
            "rate": rate,
            "questions": problematic_questions,
        })

    # Tri par taux décroissant, puis par id pour la stabilité
    annales_report.sort(key=lambda a: (-a["rate"], a.get("id") or ""))

    handler._send_json(200, {
        "totalAnnales": total_annales,
        "affectedAnnales": affected_annales,
        "totalQuestions": total_questions,
        "problematicQuestions": total_problematic,
        "annales": annales_report,
    })
