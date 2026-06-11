"""
handlers.reports — Endpoints de signalement de coquilles de parsing.

Routes gérées :
- POST  /api/reports                → crée un signalement
- GET   /api/reports?status=open    → liste les signalements (filtrés par status)
- PATCH /api/reports/<id>           → ferme un signalement (status=resolved)

Les signalements sont stockés en JSONL append-only via `core.storage.ReportStore`.
Ils ne mutent jamais le contenu des annales — la correction effective se fait
via PATCH /api/annales/<aid>/questions/<qid> (B2).
"""

import secrets

from core.models import ReportPayload
from core.storage import utc_now_iso


def _generate_report_id() -> str:
    """ID compact non séquentiel : rep_<8 hex>."""
    return f"rep_{secrets.token_hex(4)}"


def handle_report_create(handler, report_store, audit_log, payload):
    """POST /api/reports — crée un nouveau signalement."""
    try:
        validated = ReportPayload.from_dict(payload)
    except ValueError as e:
        handler._send_error(400, str(e))
        return

    report = {
        "id": _generate_report_id(),
        "annaleId": validated.annaleId,
        "questionId": validated.questionId,
        "category": validated.category,
        "note": validated.note,
        "status": "open",
        "createdAt": utc_now_iso(),
        "resolvedAt": None,
    }
    try:
        report_store.append(report)
    except OSError as e:
        handler._send_error(500, f"echec ecriture report : {e}")
        return

    audit_log("report_created", {
        "id": report["id"],
        "annaleId": report["annaleId"],
        "questionId": report["questionId"],
        "category": report["category"],
    })
    handler._send_json(201, report)


def handle_reports_summary(handler, report_store, annales_cache, orphan_count_fn):
    """
    GET /api/reports/summary — petit endpoint pour le badge "X en attente" sur
    la NavTile Corrections.

    Retourne {open: N_signalements_user, autoOrphan: N_questions_orphelines}.
    Léger pour pouvoir être polling à intervalle modéré (toutes 30s) sans
    coût.
    """
    try:
        open_reports = report_store.list(status_filter="open")
    except OSError:
        open_reports = []
    try:
        auto_count = orphan_count_fn(annales_cache)
    except Exception:
        auto_count = 0
    handler._send_json(200, {
        "open": len(open_reports),
        "autoOrphan": auto_count,
        "total": len(open_reports) + auto_count,
    })


def handle_report_list(handler, report_store, query_params):
    """
    GET /api/reports?status=open|resolved|all — liste les signalements.
    Status default = "open". Tri du plus récent au plus ancien.
    """
    status_filter = "open"
    if isinstance(query_params, dict):
        raw = query_params.get("status")
        if isinstance(raw, list) and raw:
            raw = raw[0]
        if raw in ("open", "resolved", "all"):
            status_filter = raw

    try:
        entries = report_store.list(status_filter=status_filter)
    except OSError as e:
        handler._send_error(500, f"echec lecture reports : {e}")
        return

    entries.sort(key=lambda e: e.get("createdAt") or "", reverse=True)
    handler._send_json(200, {
        "reports": entries,
        "count": len(entries),
        "status": status_filter,
    })


def handle_report_resolve(handler, report_store, audit_log, report_id, payload):
    """
    PATCH /api/reports/<id> body {status: "resolved"} — ferme un signalement.
    Pour l'instant le seul status acceptable côté PATCH est "resolved".
    """
    if not isinstance(payload, dict):
        handler._send_error(400, "payload JSON attendu")
        return
    target_status = payload.get("status")
    if target_status != "resolved":
        handler._send_error(400, "seul status='resolved' est accepte")
        return

    existing = report_store.get(report_id)
    if not existing:
        handler._send_error(404, "report inconnu")
        return

    if existing.get("status") == "resolved":
        # Idempotent
        handler._send_json(200, {**existing, "noop": True})
        return

    try:
        ok = report_store.mark_resolved(report_id)
    except OSError as e:
        handler._send_error(500, f"echec mise a jour : {e}")
        return
    if not ok:
        handler._send_error(404, "report inconnu (race condition)")
        return

    audit_log("report_resolved", {"id": report_id})
    updated = report_store.get(report_id) or {}
    handler._send_json(200, updated)
