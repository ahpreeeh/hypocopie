"""
handlers.annales — Endpoints des annales publiées.

Routes gérées :
- GET   /api/annales                 → liste résumée
- GET   /api/annales/<id>            → détail mode play (stripped)
- POST  /api/annales/<id>/grade      → grading final
- POST  /api/annales/<id>/grade-one  → grading 1 question (mode libre)
- POST  /api/annales/<id>/regroup-to-dp → conversion rétroactive QI → DP/KFP
- PATCH /api/annales/<id>            → édite title/subject/year/session/newId
"""

import hashlib
import json
import os

from core.models import QuestionPatchPayload, RegroupToDPPayload
from core.storage import safe_filename, safe_slug, utc_now_iso
from core.annale_admin import (
    clone_json,
    make_blank_question,
    next_question_id,
    normalize_admin_question,
    normalize_series_metadata,
    touch_annale_revision,
    validate_annale_admin,
    write_question_image,
)


def handle_annales_list(handler, annales_cache, annale_summary):
    """GET /api/annales — liste résumée par matière, triée."""
    summaries = [annale_summary(a) for a in annales_cache.values()]
    summaries.sort(key=lambda s: (s.get("subject") or "", s.get("year") or 0, s.get("title") or ""))
    handler._send_json(200, summaries)


def handle_annale_detail_play(handler, annales_cache, annale_for_play, aid):
    """GET /api/annales/<id> — détail mode play (sans correction/answer/correct)."""
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    handler._send_json(200, annale_for_play(annale))


def handle_annale_grade(handler, annales_cache, grade_annale, aid, payload):
    """POST /api/annales/<id>/grade — grade tout, retourne note + détails."""
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    if not isinstance(payload, dict):
        handler._send_error(400, "payload doit etre un objet JSON")
        return
    answers = payload.get("answers") or {}
    if not isinstance(answers, dict):
        handler._send_error(400, "answers doit etre un dict")
        return
    handler._send_json(200, grade_annale(annale, answers))


def handle_annale_grade_one(handler, annales_cache, grade_one_question, aid, payload):
    """POST /api/annales/<id>/grade-one — grade 1 question (mode libre)."""
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    if not isinstance(payload, dict):
        handler._send_error(400, "payload doit etre un objet JSON")
        return
    qid = payload.get("questionId")
    if not isinstance(qid, str):
        handler._send_error(400, "questionId manquant")
        return
    user_answer = payload.get("answer")
    detail = grade_one_question(annale, qid, user_answer)
    if detail is None:
        handler._send_error(404, "question inconnue dans cette annale")
        return
    handler._send_json(200, detail)


# ─────────────────────────────────────────────────────────────────────────────
# Admin workbench — édition structurelle d'annales publiées
# ─────────────────────────────────────────────────────────────────────────────


def handle_admin_annale_detail(handler, annales_cache, aid):
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    raw = clone_json(annale)
    handler._send_json(200, {
        "annale": raw,
        "validation": validate_annale_admin(raw),
    })


def handle_admin_annale_validate(handler, annales_cache, aid):
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    handler._send_json(200, validate_annale_admin(annale))


def handle_admin_annale_source(handler, annales_cache, extracted_dir, qroc_drafts_dir, aid, qid=None):
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return

    files = []
    for suffix in (".local.txt", ".txt", ".qroc-source.txt"):
        path = os.path.join(extracted_dir, f"{aid}{suffix}")
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    text = fh.read(400000)
                files.append({"name": os.path.basename(path), "text": text})
            except OSError:
                pass

    draft_blocks = []
    try:
        for name in os.listdir(qroc_drafts_dir):
            if not name.endswith(".json") or name.startswith("_"):
                continue
            path = os.path.join(qroc_drafts_dir, name)
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    draft = json.load(fh)
            except (OSError, json.JSONDecodeError):
                continue
            meta = draft.get("meta") if isinstance(draft.get("meta"), dict) else {}
            publish_log = draft.get("publishLog") if isinstance(draft.get("publishLog"), dict) else {}
            if meta.get("annaleId") != aid and publish_log.get("annaleId") != aid:
                continue
            for block in draft.get("sourceBlocks") or []:
                if not isinstance(block, dict):
                    continue
                draft_blocks.append({
                    "draftId": draft.get("id") or name[:-5],
                    "id": block.get("id"),
                    "title": block.get("title"),
                    "pages": block.get("pages"),
                    "cleanText": str(block.get("cleanText") or block.get("rawText") or "")[:40000],
                    "images": block.get("images") if isinstance(block.get("images"), list) else [],
                })
    except FileNotFoundError:
        pass

    excerpt = None
    if qid:
        question = next((q for q in annale.get("questions") or [] if isinstance(q, dict) and q.get("id") == qid), None)
        if question:
            needle = " ".join(str(question.get("text") or "").split())[:80]
            if needle:
                needle_lower = needle.lower()
                for file in files:
                    text_lower = file["text"].lower()
                    pos = text_lower.find(needle_lower[:40])
                    if pos >= 0:
                        start = max(0, pos - 1200)
                        end = min(len(file["text"]), pos + 3000)
                        excerpt = {"file": file["name"], "text": file["text"][start:end]}
                        break

    handler._send_json(200, {
        "annaleId": aid,
        "questionId": qid,
        "files": [{"name": f["name"], "text": f["text"][:60000]} for f in files],
        "excerpt": excerpt,
        "sourceBlocks": draft_blocks,
    })


def handle_admin_question_replace(
    handler,
    annales_cache,
    annale_path,
    sessions_dir,
    backup_manager,
    write_json_file_fn,
    audit_log_fn,
    aid,
    qid,
    payload,
    dry_run=False,
):
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    questions = annale.get("questions") if isinstance(annale.get("questions"), list) else None
    if questions is None:
        handler._send_error(500, "annale corrompue : champ 'questions' invalide")
        return
    index = _find_question_index(questions, qid)
    if index < 0:
        handler._send_error(404, f"question inconnue dans cette annale : {qid}")
        return
    if not isinstance(payload, dict):
        handler._send_error(400, "payload doit etre un objet JSON")
        return
    raw_question = payload.get("question") if isinstance(payload.get("question"), dict) else payload
    try:
        normalized = normalize_admin_question(raw_question, existing_id=qid)
    except ValueError as e:
        handler._send_json(400, {"error": str(e), "validation": None})
        return

    candidate = clone_json(annale)
    candidate["questions"][index] = normalized
    normalize_series_metadata(candidate)
    validation = validate_annale_admin(candidate)
    if validation["counts"]["error"] > 0:
        handler._send_json(409, {
            "error": "validation bloquante",
            "validation": validation,
        })
        return

    final_question = candidate["questions"][index]
    try:
        before_question = normalize_admin_question(questions[index], existing_id=qid)
    except ValueError:
        before_question = questions[index]
    changed = before_question != final_question
    sessions_impacted = (
        _count_sessions_with_answer(sessions_dir, aid, qid)
        if _answers_changed(before_question, final_question)
        else 0
    )
    if dry_run:
        handler._send_json(200, {
            "dryRun": True,
            "wouldChange": changed,
            "sessionsImpacted": sessions_impacted,
            "validation": validation,
        })
        return
    if not changed:
        handler._send_json(200, {
            "updated": False,
            "noop": True,
            "question": final_question,
            "sessionsImpacted": 0,
            "validation": validation,
        })
        return

    if not _ensure_admin_backup(handler, backup_manager, audit_log_fn, "admin_question_replace"):
        return
    touch_annale_revision(candidate)
    if not _write_admin_annale(handler, annales_cache, annale_path, write_json_file_fn, aid, candidate):
        return
    audit_log_fn("admin_question_replaced", {
        "annaleId": aid,
        "questionId": qid,
        "sessionsImpacted": sessions_impacted,
    })
    handler._send_json(200, {
        "updated": True,
        "question": final_question,
        "sessionsImpacted": sessions_impacted,
        "validation": validation,
        "revision": candidate.get("revision"),
    })


def handle_admin_question_create(
    handler,
    annales_cache,
    annale_path,
    backup_manager,
    write_json_file_fn,
    audit_log_fn,
    aid,
    payload,
):
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    questions = annale.get("questions") if isinstance(annale.get("questions"), list) else None
    if questions is None:
        handler._send_error(500, "annale corrompue : champ 'questions' invalide")
        return
    payload = payload if isinstance(payload, dict) else {}
    qid = next_question_id(questions)
    raw_question = payload.get("question") if isinstance(payload.get("question"), dict) else make_blank_question(qid)
    try:
        new_question = normalize_admin_question(raw_question, existing_id=qid)
    except ValueError as e:
        handler._send_error(400, str(e))
        return
    candidate = clone_json(annale)
    insert_at = len(candidate["questions"])
    after_qid = payload.get("afterQuestionId")
    if isinstance(after_qid, str):
        idx = _find_question_index(candidate["questions"], after_qid)
        if idx >= 0:
            insert_at = idx + 1
    candidate["questions"].insert(insert_at, new_question)
    normalize_series_metadata(candidate)
    validation = validate_annale_admin(candidate)
    if validation["counts"]["error"] > 0:
        handler._send_json(409, {"error": "validation bloquante", "validation": validation})
        return
    if not _ensure_admin_backup(handler, backup_manager, audit_log_fn, "admin_question_create"):
        return
    touch_annale_revision(candidate)
    if not _write_admin_annale(handler, annales_cache, annale_path, write_json_file_fn, aid, candidate):
        return
    audit_log_fn("admin_question_created", {"annaleId": aid, "questionId": qid, "insertAt": insert_at})
    handler._send_json(201, {
        "created": True,
        "question": new_question,
        "validation": validation,
        "revision": candidate.get("revision"),
    })


def handle_admin_question_delete(
    handler,
    annales_cache,
    annale_path,
    sessions_dir,
    backup_manager,
    write_json_file_fn,
    audit_log_fn,
    aid,
    qid,
):
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    questions = annale.get("questions") if isinstance(annale.get("questions"), list) else None
    if questions is None:
        handler._send_error(500, "annale corrompue : champ 'questions' invalide")
        return
    if len(questions) <= 1:
        handler._send_error(409, "impossible de supprimer la derniere question")
        return
    index = _find_question_index(questions, qid)
    if index < 0:
        handler._send_error(404, f"question inconnue dans cette annale : {qid}")
        return
    candidate = clone_json(annale)
    removed = candidate["questions"].pop(index)
    normalize_series_metadata(candidate)
    validation = validate_annale_admin(candidate)
    if not _ensure_admin_backup(handler, backup_manager, audit_log_fn, "admin_question_delete"):
        return
    touch_annale_revision(candidate)
    if not _write_admin_annale(handler, annales_cache, annale_path, write_json_file_fn, aid, candidate):
        return
    sessions_impacted = _count_sessions_with_answer(sessions_dir, aid, qid)
    audit_log_fn("admin_question_deleted", {
        "annaleId": aid,
        "questionId": qid,
        "sessionsImpacted": sessions_impacted,
    })
    handler._send_json(200, {
        "deleted": True,
        "questionId": qid,
        "removed": removed,
        "sessionsImpacted": sessions_impacted,
        "validation": validation,
        "revision": candidate.get("revision"),
    })


def handle_admin_questions_reorder(
    handler,
    annales_cache,
    annale_path,
    backup_manager,
    write_json_file_fn,
    audit_log_fn,
    aid,
    payload,
):
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    if not isinstance(payload, dict) or not isinstance(payload.get("questionIds"), list):
        handler._send_error(400, "questionIds requis")
        return
    questions = annale.get("questions") if isinstance(annale.get("questions"), list) else None
    if questions is None:
        handler._send_error(500, "annale corrompue : champ 'questions' invalide")
        return
    ids = [str(qid) for qid in payload["questionIds"]]
    current_ids = [str(q.get("id")) for q in questions if isinstance(q, dict)]
    if sorted(ids) != sorted(current_ids) or len(ids) != len(current_ids):
        handler._send_error(409, "questionIds doit contenir exactement les questions de l'annale")
        return
    by_id = {str(q.get("id")): q for q in clone_json(questions)}
    candidate = clone_json(annale)
    candidate["questions"] = [by_id[qid] for qid in ids]
    normalize_series_metadata(candidate)
    validation = validate_annale_admin(candidate)
    if validation["counts"]["error"] > 0:
        handler._send_json(409, {"error": "validation bloquante", "validation": validation})
        return
    if not _ensure_admin_backup(handler, backup_manager, audit_log_fn, "admin_questions_reorder"):
        return
    touch_annale_revision(candidate)
    if not _write_admin_annale(handler, annales_cache, annale_path, write_json_file_fn, aid, candidate):
        return
    audit_log_fn("admin_questions_reordered", {"annaleId": aid, "questionIds": ids})
    handler._send_json(200, {"updated": True, "validation": validation, "revision": candidate.get("revision")})


def handle_admin_question_image_upload(
    handler,
    annales_cache,
    annale_path,
    annale_images_dir,
    backup_manager,
    write_json_file_fn,
    audit_log_fn,
    aid,
    qid,
    payload,
):
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    questions = annale.get("questions") if isinstance(annale.get("questions"), list) else None
    index = _find_question_index(questions or [], qid)
    if index < 0:
        handler._send_error(404, f"question inconnue dans cette annale : {qid}")
        return
    if not isinstance(payload, dict) or not isinstance(payload.get("dataUrl"), str):
        handler._send_error(400, "dataUrl requis")
        return
    try:
        filename = write_question_image(annale_images_dir(aid), qid, payload["dataUrl"])
    except ValueError as e:
        handler._send_error(400, str(e))
        return
    candidate = clone_json(annale)
    q = candidate["questions"][index]
    images = q.get("images") if isinstance(q.get("images"), list) else []
    entry = {
        "id": f"img_{len(images) + 1}",
        "filename": filename,
        "label": str(payload.get("label") or "")[:200],
        "addedAt": utc_now_iso(),
    }
    q["images"] = images + [entry]
    q["image"] = filename
    validation = validate_annale_admin(candidate)
    if not _ensure_admin_backup(handler, backup_manager, audit_log_fn, "admin_question_image_upload"):
        return
    touch_annale_revision(candidate)
    if not _write_admin_annale(handler, annales_cache, annale_path, write_json_file_fn, aid, candidate):
        return
    audit_log_fn("admin_question_image_uploaded", {"annaleId": aid, "questionId": qid, "filename": filename})
    handler._send_json(201, {
        "uploaded": True,
        "image": entry,
        "question": q,
        "validation": validation,
        "revision": candidate.get("revision"),
    })


def handle_admin_question_image_delete(
    handler,
    annales_cache,
    annale_path,
    annale_images_dir,
    backup_manager,
    write_json_file_fn,
    audit_log_fn,
    aid,
    qid,
    filename,
):
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    questions = annale.get("questions") if isinstance(annale.get("questions"), list) else None
    index = _find_question_index(questions or [], qid)
    if index < 0:
        handler._send_error(404, f"question inconnue dans cette annale : {qid}")
        return
    filename = safe_filename(filename)
    if not filename:
        handler._send_error(400, "nom image invalide")
        return
    candidate = clone_json(annale)
    q = candidate["questions"][index]
    images = q.get("images") if isinstance(q.get("images"), list) else []
    q["images"] = [img for img in images if img.get("filename") != filename]
    if q.get("image") == filename:
        q["image"] = q["images"][0].get("filename") if q["images"] else None
    if len(q["images"]) == len(images) and q.get("image") != filename:
        handler._send_error(404, "image inconnue sur cette question")
        return
    validation = validate_annale_admin(candidate)
    if not _ensure_admin_backup(handler, backup_manager, audit_log_fn, "admin_question_image_delete"):
        return
    touch_annale_revision(candidate)
    if not _write_admin_annale(handler, annales_cache, annale_path, write_json_file_fn, aid, candidate):
        return
    try:
        os.remove(os.path.join(annale_images_dir(aid), filename))
    except FileNotFoundError:
        pass
    except OSError:
        pass
    audit_log_fn("admin_question_image_deleted", {"annaleId": aid, "questionId": qid, "filename": filename})
    handler._send_json(200, {
        "deleted": True,
        "filename": filename,
        "question": q,
        "validation": validation,
        "revision": candidate.get("revision"),
    })


def _find_question_index(questions, qid):
    for index, q in enumerate(questions):
        if isinstance(q, dict) and q.get("id") == qid:
            return index
    return -1


def _answers_changed(before, after):
    keys = ("questionType", "options", "expectedAnswer")
    return any(before.get(key) != after.get(key) for key in keys)


def _ensure_admin_backup(handler, backup_manager, audit_log_fn, trigger):
    if backup_manager is None:
        return True
    try:
        info = backup_manager.create()
        audit_log_fn("backup_created", {
            "filename": info.get("filename"),
            "trigger": trigger,
        })
        return True
    except Exception as e:
        handler._send_error(500, f"backup obligatoire echoue : {e}")
        return False


def _write_admin_annale(handler, annales_cache, annale_path, write_json_file_fn, aid, annale):
    try:
        write_json_file_fn(annale_path(aid), annale)
    except OSError as e:
        handler._send_error(500, f"ecriture annale echouee : {e}")
        return False
    annales_cache[aid] = annale
    return True


def handle_annale_regroup_to_dp(
    handler,
    annales_cache,
    annale_path,
    write_json_file_fn,
    audit_log_fn,
    aid,
    payload,
):
    """
    POST /api/annales/<aid>/regroup-to-dp — regroupe ≥ 2 questions QI
    (sans seriesId) en une nouvelle série DP/KFP avec vignette partagée.

    Payload validé par core.models.RegroupToDPPayload :
        {
            "questionIds": ["q1", "q3", ...],   # ≥ 2, ordre = ordre dans la série
            "seriesTitle": "Insuffisance cardiaque chez Mme X",
            "vignette":    "Mme X, 78 ans, ...",
            "seriesFormat": "DP" | "KFP"        # défaut "DP"
        }

    Comportement :
      - 400 si payload invalide (typage, longueurs, doublons, < 2 questions)
      - 404 si annale inconnue
      - 400 si une questionId n'existe pas dans l'annale
      - 409 si une question cible a déjà un seriesId (non-QI)
      - Génère un seriesId unique : `dp-<slug(title)>-<hash6>` (max 60 chars)
      - Q1 reçoit : seriesId, seriesFormat, seriesPosition=1, seriesTotal=N,
                    vignette, customTitle
      - Q2..N reçoivent : mêmes champs sauf vignette=None
      - Écriture atomique du fichier annale + mise à jour cache + audit log
      - Retourne {"updated": True, "seriesId": ..., "questionsAffected": N}
    """
    # 1) Validation du payload
    try:
        validated = RegroupToDPPayload.from_dict(payload)
    except ValueError as e:
        handler._send_error(400, str(e))
        return

    # 2) Existence de l'annale
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return

    questions = annale.get("questions") or []
    if not isinstance(questions, list):
        handler._send_error(500, "annale corrompue : champ 'questions' invalide")
        return

    # Index par id pour O(1) lookup, garde l'ordre original pour réécriture
    qid_to_question = {}
    for q in questions:
        if isinstance(q, dict):
            q_id = q.get("id")
            if isinstance(q_id, str):
                qid_to_question[q_id] = q

    # 3) Toutes les questionIds doivent exister dans cette annale
    missing = [qid for qid in validated.questionIds if qid not in qid_to_question]
    if missing:
        handler._send_error(
            400,
            f"questionIds inconnues dans cette annale : {', '.join(missing[:5])}",
        )
        return

    # 4) Aucune des questions cibles ne doit déjà appartenir à une série
    already_in_series = []
    for qid in validated.questionIds:
        existing_series = qid_to_question[qid].get("seriesId")
        if existing_series:
            already_in_series.append(qid)
    if already_in_series:
        handler._send_error(
            409,
            f"questions déjà rattachées à une série : {', '.join(already_in_series[:5])}",
        )
        return

    # 5) Génération du seriesId déterministe (slug + hash court)
    slug = safe_slug(validated.seriesTitle, fallback="dossier")
    hash_suffix = hashlib.md5(
        f"{aid}-{validated.seriesTitle}".encode("utf-8")
    ).hexdigest()[:6]
    series_id = f"dp-{slug}-{hash_suffix}"[:60]

    # 6) Application des champs de série sur chaque question ciblée
    total = len(validated.questionIds)
    for position, qid in enumerate(validated.questionIds, start=1):
        q = qid_to_question[qid]
        q["seriesId"] = series_id
        q["seriesFormat"] = validated.seriesFormat
        q["seriesPosition"] = position
        q["seriesTotal"] = total
        q["customTitle"] = validated.seriesTitle
        if position == 1:
            q["vignette"] = validated.vignette
        else:
            # On vide explicitement la vignette des questions suivantes (Q2..N)
            # pour respecter le modèle DP : vignette portée par Q1 seulement.
            q["vignette"] = None

    # 7) Écriture atomique et mise à jour cache
    try:
        write_json_file_fn(annale_path(aid), annale)
    except OSError as e:
        handler._send_error(500, f"ecriture annale echouee : {e}")
        return

    annales_cache[aid] = annale

    # 8) Audit log
    audit_log_fn(
        "regroup_questions_to_dp",
        {
            "annaleId": aid,
            "seriesId": series_id,
            "seriesFormat": validated.seriesFormat,
            "seriesTitle": validated.seriesTitle,
            "questionIds": list(validated.questionIds),
        },
    )

    handler._send_json(
        200,
        {
            "updated": True,
            "seriesId": series_id,
            "questionsAffected": total,
        },
    )


# ────────────────────────────────────────────────────────────────────
# PATCH d'une question publiée (B2 — édition ciblée Niveau 2)
# ────────────────────────────────────────────────────────────────────


def _count_sessions_with_answer(sessions_dir, aid, qid):
    """
    Scan data/exam-sessions/ et compte le nombre de sessions ayant une réponse
    enregistrée pour `qid` dans `aid`. Utilisé pour warner avant un PATCH
    qui change options[].correct ou expectedAnswer (les scores deviennent
    incohérents si non recalculés).
    """
    if not os.path.isdir(sessions_dir):
        return 0
    count = 0
    for name in os.listdir(sessions_dir):
        if not name.endswith(".json"):
            continue
        path = os.path.join(sessions_dir, name)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                s = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        if s.get("annaleId") != aid:
            continue
        answers = s.get("answers") or {}
        if not isinstance(answers, dict):
            continue
        if qid in answers and answers[qid] not in (None, "", []):
            count += 1
    return count


def _apply_question_patch(question, patch):
    """
    Applique le patch en place sur la question. Retourne (changed_fields, conflicts).
    - changed_fields : liste des clés effectivement modifiées (≠ valeur actuelle).
    - conflicts : liste des erreurs structurelles (ex: options length mismatch).
    """
    changed = []
    conflicts = []

    # Textes simples
    text_fields = ("text", "vignette", "correctionText", "expectedAnswer", "customTitle")
    for field in text_fields:
        if field not in patch.provided_keys:
            continue
        new_value = getattr(patch, field)
        # Convention : si on passe "" on vide à None (sauf text qui doit rester non-vide).
        if field == "text":
            if not new_value:
                conflicts.append("text ne peut pas etre vide")
                continue
            current = question.get(field)
            if current != new_value:
                question[field] = new_value
                changed.append(field)
        else:
            # Pour les optionnels : "" → None (vidage explicite)
            normalized = new_value if new_value else None
            current = question.get(field)
            if current != normalized:
                question[field] = normalized
                changed.append(field)

    # Options : longueur et ids préservés
    if "options" in patch.provided_keys and patch.options is not None:
        current_opts = question.get("options") or []
        if not isinstance(current_opts, list):
            conflicts.append("annale corrompue : options actuelles invalides")
            return changed, conflicts
        if len(current_opts) != len(patch.options):
            conflicts.append(
                f"options : longueur differente (actuel={len(current_opts)}, patch={len(patch.options)})"
            )
            return changed, conflicts
        current_ids = [o.get("id") for o in current_opts if isinstance(o, dict)]
        patch_ids = [o["id"] for o in patch.options]
        if current_ids != patch_ids:
            conflicts.append(f"options : ids ne correspondent pas (actuel={current_ids}, patch={patch_ids})")
            return changed, conflicts
        # Check si quelque chose change réellement
        any_opt_change = False
        for cur, new in zip(current_opts, patch.options):
            if cur.get("text") != new["text"] or bool(cur.get("correct")) != bool(new["correct"]):
                any_opt_change = True
                break
        if any_opt_change:
            # Préserver toutes les clés existantes (image, etc) en n'écrasant que text/correct
            for cur, new in zip(current_opts, patch.options):
                cur["text"] = new["text"]
                cur["correct"] = bool(new["correct"])
            changed.append("options")

    return changed, conflicts


def handle_annale_patch_question(
    handler,
    annales_cache,
    annale_path,
    sessions_dir,
    backup_manager,
    write_json_file_fn,
    audit_log_fn,
    aid,
    qid,
    payload,
    dry_run=False,
    backup_done_ref=None,
):
    """
    PATCH /api/annales/<aid>/questions/<qid> — édition ciblée Niveau 2.

    Scope : textes (text, vignette, correctionText, expectedAnswer, customTitle)
    + options[].text + options[].correct. Structure interdite (cf.
    QUESTION_PATCH_FORBIDDEN).

    Mode dry-run : si dry_run=True, ne mute rien et retourne uniquement
    {wouldChange, sessionsImpacted, changedFields, conflicts}. Utilisé par
    la modale F2 pour afficher un warning avant submit final.

    Comportement live :
      1. Valide payload via QuestionPatchPayload
      2. Vérifie aid + qid existent
      3. Calcule changedFields + conflicts (sans muter)
      4. Compte sessionsImpacted si change correct/expectedAnswer
      5. Si dry_run → renvoie, fini
      6. Backup auto via backup_manager si pas déjà fait dans la session (via backup_done_ref)
      7. Applique le patch en place
      8. Write atomique de l'annale
      9. Refresh cache + audit log
      10. Retourne {updated, changedFields, sessionsImpacted}
    """
    # 1) Validation payload (incluant champs interdits)
    try:
        validated = QuestionPatchPayload.from_dict(payload)
    except ValueError as e:
        handler._send_error(400, str(e))
        return

    if not validated.has_changes():
        handler._send_error(400, "aucun champ a modifier fourni")
        return

    # 2) Existence annale + question
    annale = annales_cache.get(aid)
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    questions = annale.get("questions") or []
    if not isinstance(questions, list):
        handler._send_error(500, "annale corrompue : champ 'questions' invalide")
        return
    target = None
    for q in questions:
        if isinstance(q, dict) and q.get("id") == qid:
            target = q
            break
    if not target:
        handler._send_error(404, f"question inconnue dans cette annale : {qid}")
        return

    # 3) Calcul dry-run sur copie
    target_copy = json.loads(json.dumps(target))  # deep clone simple
    changed_fields, conflicts = _apply_question_patch(target_copy, validated)
    if conflicts:
        handler._send_error(409, "conflit(s) detecte(s) : " + " | ".join(conflicts))
        return

    # 4) Compte sessions impactées si change correct/expectedAnswer
    sessions_impacted = 0
    if validated.changes_correct_answers() and (
        "options" in changed_fields or "expectedAnswer" in changed_fields
    ):
        sessions_impacted = _count_sessions_with_answer(sessions_dir, aid, qid)

    # 5) Mode dry-run : retourner sans muter
    if dry_run:
        handler._send_json(200, {
            "dryRun": True,
            "wouldChange": bool(changed_fields),
            "changedFields": changed_fields,
            "sessionsImpacted": sessions_impacted,
        })
        return

    # 6) Idempotence : rien à faire
    if not changed_fields:
        handler._send_json(200, {
            "updated": False,
            "noop": True,
            "changedFields": [],
            "sessionsImpacted": 0,
        })
        return

    # 7) Backup avant 1ère mutation de la session
    if backup_manager is not None and (backup_done_ref is None or not backup_done_ref.get("done")):
        try:
            info = backup_manager.create()
            if backup_done_ref is not None:
                backup_done_ref["done"] = True
            audit_log_fn("backup_created", {
                "filename": info.get("filename"),
                "trigger": "annale_question_patch",
            })
        except Exception as e:
            handler._send_error(500, f"backup obligatoire echoue : {e}")
            return

    # 8) Application réelle sur la question d'origine
    _apply_question_patch(target, validated)

    # 9) Écriture atomique
    try:
        write_json_file_fn(annale_path(aid), annale)
    except OSError as e:
        handler._send_error(500, f"ecriture annale echouee : {e}")
        return

    annales_cache[aid] = annale

    # 10) Audit log
    audit_log_fn("annale_question_patched", {
        "annaleId": aid,
        "questionId": qid,
        "changedFields": changed_fields,
        "sessionsImpacted": sessions_impacted,
    })

    handler._send_json(200, {
        "updated": True,
        "changedFields": changed_fields,
        "sessionsImpacted": sessions_impacted,
    })
