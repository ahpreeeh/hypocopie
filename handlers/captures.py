"""
handlers.captures — Endpoints captures (extension Chrome).

Routes gérées :
- GET    /api/captures              → liste light
- GET    /api/captures/<qid>        → détail
- POST   /api/captures              → création + dédup
- PATCH  /api/captures/<qid>        → édite customTitle/chapter
- DELETE /api/captures/<qid>        → supprime
- POST   /api/captures/<qid>/screenshots → ajout screenshot
- DELETE /api/captures/<qid>/images/<image_id> → supprime image
"""

import json
import os


def handle_capture_list(handler, list_captures_fn):
    """GET /api/captures — liste light (sans imageB64)."""
    handler._send_json(200, list_captures_fn())


def handle_capture_detail(handler, capture_path, qid):
    """GET /api/captures/<qid> — détail complet."""
    file = capture_path(qid)
    if not os.path.isfile(file):
        handler._send_error(404, "capture inconnue")
        return
    try:
        with open(file, "r", encoding="utf-8") as fh:
            handler._send_json(200, json.load(fh))
    except (OSError, json.JSONDecodeError) as e:
        handler._send_error(500, f"lecture impossible : {e}")


def handle_capture_delete(
    handler, capture_path, audit_log,
    unregister_question_from_indexes, qid,
):
    """DELETE /api/captures/<qid>."""
    file = capture_path(qid)
    if not os.path.isfile(file):
        handler._send_error(404, "capture inconnue")
        return
    try:
        os.remove(file)
    except OSError as e:
        handler._send_error(500, f"suppression echouee : {e}")
        return
    unregister_question_from_indexes(qid)
    audit_log("delete_capture", {"questionId": qid})
    handler._send_json(200, {"deleted": True, "id": qid})


def handle_capture_patch(
    handler, capture_path, write_json_file,
    qid, payload,
):
    """PATCH /api/captures/<qid> — édite customTitle / chapter (text seulement)."""
    file = capture_path(qid)
    if not os.path.isfile(file):
        handler._send_error(404, "capture inconnue")
        return
    if not isinstance(payload, dict):
        handler._send_error(400, "payload doit etre un objet JSON")
        return
    editable = {"customTitle", "chapter"}
    updates = {}
    for key in editable:
        if key not in payload:
            continue
        value = payload[key]
        if value is None:
            updates[key] = None
            continue
        if not isinstance(value, str):
            continue
        cleaned = value.strip()[:300]
        updates[key] = cleaned or None
    if not updates:
        handler._send_error(400, "aucun champ editable fourni (customTitle, chapter)")
        return
    try:
        with open(file, "r", encoding="utf-8") as fh:
            question = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        handler._send_error(500, f"lecture impossible : {e}")
        return
    for key, value in updates.items():
        if value is None:
            question.pop(key, None)
        else:
            question[key] = value
    try:
        write_json_file(file, question)
    except OSError as e:
        handler._send_error(500, f"ecriture echouee : {e}")
        return
    handler._send_json(200, {"updated": True, "id": qid, "fields": list(updates.keys())})
