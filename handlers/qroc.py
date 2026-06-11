"""
handlers.qroc — Endpoints du workflow QROC (drafts, conversion, publish).

Routes gérées :
- GET    /api/annales/drafts                           → liste drafts
- GET    /api/annales/drafts/<id>                      → détail draft
- POST   /api/annales/convert-qroc/extract             → découpe PDF en blocs
- POST   /api/annales/convert-qroc/drafts/<id>/generate → lance la génération DeepSeek
- GET    /api/annales/convert-qroc/jobs/<id>           → statut job (polling)
- POST   /api/annales/convert-qroc/jobs/<id>/cancel    → annule job
- PATCH  /api/annales/drafts/<id>                      → édite blocs/questions
- PATCH  /api/annales/convert-qroc/drafts/<id>/source-blocks → édite blocs
- POST   /api/annales/drafts/<id>/publish              → publication (auto-rename si collision)
- DELETE /api/annales/drafts/<id>                      → supprime draft

NOTE : ces handlers sont les plus complexes (interaction avec workers, semaphore,
audit log). Pour l'instant le code reste dans server.py — ce fichier sert de
référence du périmètre attendu pour la future migration complète.
"""


def handle_drafts_list(handler, list_drafts_fn):
    """GET /api/annales/drafts — liste résumée des drafts."""
    handler._send_json(200, list_drafts_fn())


def handle_draft_detail(handler, load_qroc_draft, draft_id):
    """GET /api/annales/drafts/<id> — détail complet d'un draft."""
    draft = load_qroc_draft(draft_id)
    if not draft:
        handler._send_error(404, "brouillon inconnu")
        return
    handler._send_json(200, draft)


def handle_job_status(handler, load_qroc_job, job_id):
    """GET /api/annales/convert-qroc/jobs/<id> — statut du job (polling 1500ms côté UI)."""
    job = load_qroc_job(job_id)
    if not job:
        handler._send_error(404, "job inconnu")
        return
    handler._send_json(200, job)


def handle_draft_delete(handler, load_qroc_draft, qroc_draft_path, audit_log, draft_id):
    """DELETE /api/annales/drafts/<id> — supprime un draft."""
    import os
    import shutil
    draft = load_qroc_draft(draft_id)
    if not draft:
        handler._send_error(404, "brouillon inconnu")
        return
    file = qroc_draft_path(draft_id)
    try:
        if os.path.isfile(file):
            os.remove(file)
        # Supprime aussi le dossier d'images du draft
        from os.path import join, dirname
        images_dir = join(dirname(file), draft_id)
        if os.path.isdir(images_dir):
            shutil.rmtree(images_dir, ignore_errors=True)
    except OSError as e:
        handler._send_error(500, f"suppression draft echouee : {e}")
        return
    audit_log("delete_draft", {"draftId": draft_id})
    handler._send_json(200, {"deleted": True, "id": draft_id})


def handle_job_cancel(handler, load_qroc_job, save_qroc_job, cancel_requests_set, job_id):
    """
    POST /api/annales/convert-qroc/jobs/<id>/cancel — demande l'annulation d'un job en cours.
    Si le job est déjà terminé (done/error/cancelled), retourne 200 idempotent.
    Sinon : ajoute l'ID au set des cancels, marque le job en 'cancelling',
    et laisse le worker QROC voir le flag à sa prochaine boucle.
    """
    job = load_qroc_job(job_id)
    if not job:
        handler._send_error(404, "job inconnu")
        return
    if job.get("status") in {"done", "done-with-errors", "error", "cancelled", "interrupted"}:
        handler._send_json(200, job)
        return
    cancel_requests_set.add(job["id"])
    job["status"] = "cancelling"
    save_qroc_job(job)
    handler._send_json(200, job)


# NOTE : les handlers complexes (extract, generate, cancel, publish, patch) ne sont
# pas encore extraits car ils dépendent de QROC_JOB_QUEUE, run_qroc_generation_job,
# normalize_source_blocks_for_patch, etc. — du code applicatif coeur encore dans server.py.
# Ils seront migrés au fur et à mesure que la suite de tests sera disponible.
