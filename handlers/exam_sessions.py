"""
handlers.exam_sessions — Endpoints des sessions d'examen (historique).

Routes gérées :
- GET    /api/exam-sessions
- GET    /api/exam-sessions/<id>
- POST   /api/exam-sessions
- DELETE /api/exam-sessions/<id>
"""

import json
import os
from datetime import datetime, timezone


def handle_session_list(handler, list_sessions_fn):
    """GET /api/exam-sessions — liste résumée des sessions."""
    handler._send_json(200, list_sessions_fn())


def handle_session_detail(handler, session_path, session_id, transform_session_fn=None):
    """GET /api/exam-sessions/<id> — détail complet (réponses + corrections)."""
    file = session_path(session_id)
    if not os.path.isfile(file):
        handler._send_error(404, "session inconnue")
        return
    try:
        with open(file, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        handler._send_error(500, f"lecture impossible : {e}")
        return
    if transform_session_fn:
        data = transform_session_fn(data)
    handler._send_json(200, data)


def handle_session_create(
    handler,
    payload,
    annales_cache,
    grade_annale,
    write_json_file,
    session_path,
    generate_session_id,
):
    """
    POST /api/exam-sessions — sauvegarde une session d'examen.
    Le grading est recalculé serveur-side pour empêcher la triche.
    """
    if not isinstance(payload, dict):
        handler._send_error(400, "payload doit etre un objet JSON")
        return
    annale_id = payload.get("annaleId")
    annale = annales_cache.get(annale_id) if isinstance(annale_id, str) else None
    if not annale:
        handler._send_error(404, "annale inconnue")
        return
    mode = str(payload.get("mode") or "").lower()
    if mode not in {"exam", "libre"}:
        handler._send_error(400, "mode doit etre 'exam' ou 'libre'")
        return
    answers = payload.get("answers") or {}
    if not isinstance(answers, dict):
        handler._send_error(400, "answers doit etre un dict")
        return
    # Re-grading serveur-side (anti-triche)
    grading = grade_annale(annale, answers)
    session_id = generate_session_id()
    session = {
        "id": session_id,
        "annaleId": annale_id,
        "annaleTitle": annale.get("title"),
        "annaleSubject": annale.get("subject"),
        "annaleYear": annale.get("year"),
        "annaleSession": annale.get("session"),
        "annaleRevision": annale.get("revision") or 0,
        "mode": mode,
        "startedAt": payload.get("startedAt"),
        "submittedAt": payload.get("submittedAt") or datetime.now(timezone.utc).isoformat(),
        "durationSec": payload.get("durationSec"),
        "answers": answers,
        "finalScore": grading.get("finalScore"),
        "details": grading.get("details"),
    }
    try:
        write_json_file(session_path(session_id), session)
    except OSError as e:
        handler._send_error(500, f"ecriture session echouee : {e}")
        return
    handler._send_json(200, {"saved": True, "id": session_id})


def handle_session_delete(handler, session_path, audit_log, session_id):
    """DELETE /api/exam-sessions/<id> — supprime une session."""
    file = session_path(session_id)
    if not os.path.isfile(file):
        handler._send_error(404, "session inconnue")
        return
    try:
        os.remove(file)
    except OSError as e:
        handler._send_error(500, f"suppression session echouee : {e}")
        return
    audit_log("delete_exam_session", {"sessionId": session_id})
    handler._send_json(200, {"deleted": True, "id": session_id})
