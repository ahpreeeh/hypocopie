"""
Serveur localhost pour les captures Hypocampus.

- Sert les fichiers statiques de web/ a la racine /
- API REST sur /api/captures pour lire/ecrire les captures (1 fichier JSON par question)

Lance via start-server.bat ou : python server.py
Bind sur 127.0.0.1 uniquement (jamais expose au LAN).
"""

import base64
import concurrent.futures
import hashlib
import json
import os
import queue
import re
import shutil
import threading
import traceback
import sys

# Modules internes (Phase 1 — modularisation)
from core.storage import (
    SAFE_ID,
    safe_filename,
    safe_slug,
    utc_now_iso,
    audit as _audit_singleton,
    BackupManager,
    ReportStore,
)
from core.deepseek import (
    DEEPSEEK_CHAT_URL,
    DEEPSEEK_MODELS,
    DEEPSEEK_MAX_CONCURRENT_CALLS,
    call_deepseek_json,
)
from core.text_utils import (
    fold_ascii,
    clean_pdf_text,
    int_or_none,
    normalize_question_id,
)
from core.qroc_blocks import validate_source_block
from core.parsing import (
    parse_qroc_source_pdf as _parse_qroc_source_pdf_core,
    parse_uness_correction_local,
    write_annale_images as _write_annale_images_core,
)
from core.options import shuffle_questions_options
from core.models import (
    ExamSessionPayload,
    LocalImportMeta,
    AnnalePatchPayload,
    GradeAllPayload,
    GradeOnePayload,
)

# Handlers HTTP par domaine (Phase 1 — modularisation)
import handlers.admin
import handlers.annales
import handlers.captures
import handlers.exam_sessions
import handlers.qroc
import handlers.reports
import unicodedata
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib import error as urlerror
from urllib import request as urlrequest

HOST = "127.0.0.1"
PORT = 8765

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web", "dist")
DATA_DIR = os.path.join(ROOT, "data", "captures")
ANNALES_DIR = os.path.join(ROOT, "data", "annales")
EXTRACTED_DIR = os.path.join(ANNALES_DIR, "_extracted")
QROC_DRAFTS_DIR = os.path.join(ANNALES_DIR, "_drafts")
QROC_JOBS_DIR = os.path.join(QROC_DRAFTS_DIR, "jobs")
EXAM_SESSIONS_DIR = os.path.join(ROOT, "data", "exam-sessions")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(ANNALES_DIR, exist_ok=True)
os.makedirs(EXTRACTED_DIR, exist_ok=True)
os.makedirs(QROC_DRAFTS_DIR, exist_ok=True)
os.makedirs(QROC_JOBS_DIR, exist_ok=True)
os.makedirs(EXAM_SESSIONS_DIR, exist_ok=True)

# SAFE_ID importé depuis core.storage (Phase 1 — modularisation)
# DEEPSEEK_* importés depuis core.deepseek (Phase 1 — modularisation)

MAX_IMPORT_PAYLOAD_BYTES = 80 * 1024 * 1024
QROC_JOB_QUEUE = queue.Queue()
QROC_JOB_LOCK = threading.Lock()
QROC_FILE_LOCK = threading.Lock()
QROC_WORKER_STARTED = False
QROC_CANCEL_REQUESTS = set()
QROC_OPTION_IDS = list("ABCDEFGHIJKLMNO")
QROC_JOB_WORKER_COUNT = 2
QROC_BLOCK_WORKERS = 4
# DEEPSEEK_* importés depuis core.deepseek (Phase 1)

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}


def capture_path(qid: str) -> str:
    return os.path.join(DATA_DIR, f"q_{qid}.json")


# ────────────────────────────────────────────────────────────────────
# Signatures pour anti-doublon + détection de revue
# ────────────────────────────────────────────────────────────────────
#
# DEUX niveaux :
#   - session_sig  : tout l'identique (URL, réponses cochées, position)
#                    → refus sec si même session
#   - content_sig  : la question elle-même (énoncé, correction, options)
#                    → si match mais session_sig différente, c'est une REVUE :
#                      on ajoute une entrée seenAgain[] au fichier existant


def _normalize_text(s):
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFC", s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def compute_session_signature(q):
    """Identifie une capture précise (extension Chrome → cette session précise)."""
    parts = [
        _normalize_text(q.get("format")),
        _normalize_text(q.get("subject")),
        _normalize_text(q.get("seriesId")),
        str(q.get("seriesPosition") if q.get("seriesPosition") is not None else ""),
        _normalize_text(q.get("url")),
        _normalize_text(q.get("vignette")),
        _normalize_text(q.get("questionText")),
        _normalize_text(q.get("correctionText")),
        "||".join(_normalize_text(a) for a in (q.get("correctAnswers") or [])),
        "||".join(_normalize_text(a) for a in (q.get("selectedAnswers") or [])),
        "||".join(
            f"{_normalize_text(a.get('userAnswer'))}->{_normalize_text(a.get('expectedAnswer'))}"
            for a in (q.get("freeAnswers") or [])
        ),
    ]
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compute_content_signature(q):
    """Identifie LA question elle-même indépendamment de la session.
    Si match → c'est la même question revue dans une autre session/avec d'autres réponses."""
    options = q.get("options") or []
    option_texts = sorted(_normalize_text(o.get("text")) for o in options if isinstance(o, dict))
    free_answers = q.get("freeAnswers") or []
    expected_texts = "||".join(
        _normalize_text(a.get("expectedAnswer")) for a in free_answers if isinstance(a, dict)
    )
    parts = [
        _normalize_text(q.get("questionText")),
        _normalize_text(q.get("correctionText")),
        _normalize_text(q.get("vignette")),
        "||".join(_normalize_text(a) for a in (q.get("correctAnswers") or [])),
        "||".join(option_texts),
        expected_texts,
    ]
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# Indexes en mémoire — peuplés au démarrage et maintenus en live
# Protégés par INDEX_LOCK car mutés depuis plusieurs threads HTTP (ThreadingHTTPServer).
_session_index = {}   # session_sig → question_id
_content_index = {}   # content_sig → question_id (premier rencontré)
INDEX_LOCK = threading.Lock()


def register_question_in_indexes(q):
    """Ajoute une question (déjà persistée) aux deux indexes. Thread-safe via INDEX_LOCK."""
    qid = q.get("id")
    if not qid:
        return
    s_sig = compute_session_signature(q)
    c_sig = compute_content_signature(q)
    with INDEX_LOCK:
        _session_index[s_sig] = qid
        _content_index.setdefault(c_sig, qid)
        # Une question peut avoir des seenAgain : on indexe aussi leurs signatures
        for entry in (q.get("seenAgain") or []):
            if not isinstance(entry, dict):
                continue
            # On reconstruit un sous-set pour calculer la session_sig de la revue
            revue = dict(q)
            revue["url"] = entry.get("url")
            revue["selectedAnswers"] = entry.get("selectedAnswers") or []
            _session_index[compute_session_signature(revue)] = qid


def unregister_question_from_indexes(qid):
    """Retire toutes les entrées d'index pointant vers qid. Thread-safe via INDEX_LOCK."""
    with INDEX_LOCK:
        for sig in [s for s, v in _session_index.items() if v == qid]:
            del _session_index[sig]
        for sig in [s for s, v in _content_index.items() if v == qid]:
            del _content_index[sig]


def lookup_session_index(sig):
    """Lecture thread-safe."""
    with INDEX_LOCK:
        return _session_index.get(sig)


def lookup_content_index(sig):
    """Lecture thread-safe."""
    with INDEX_LOCK:
        return _content_index.get(sig)


def set_session_index(sig, qid):
    """Écriture thread-safe (utilisée pour réindexer une revue/réponse différente sur même question)."""
    with INDEX_LOCK:
        _session_index[sig] = qid


def rebuild_indexes():
    """Reconstruit les indexes depuis le disque (au démarrage). Thread-safe via INDEX_LOCK."""
    with INDEX_LOCK:
        _session_index.clear()
        _content_index.clear()
    if not os.path.isdir(DATA_DIR):
        return
    count = 0
    for name in os.listdir(DATA_DIR):
        if not (name.startswith("q_") and name.endswith(".json")):
            continue
        try:
            with open(os.path.join(DATA_DIR, name), "r", encoding="utf-8") as fh:
                q = json.load(fh)
            register_question_in_indexes(q)
            count += 1
        except Exception as e:
            print(f"[warn] index illisible {name} : {e}", file=sys.stderr)
    with INDEX_LOCK:
        session_count = len(_session_index)
        content_count = len(_content_index)
    print(f"[index] {count} questions indexées | {session_count} sessions | {content_count} contenus uniques")


# ────────────────────────────────────────────────────────────────────
# Annales jouables (mode entraînement examen)
# ────────────────────────────────────────────────────────────────────

# Cache en RAM des annales chargées au démarrage (clé = annaleId)
_annales_cache = {}


def annale_path(annale_id: str) -> str:
    return os.path.join(ANNALES_DIR, f"{annale_id}.json")


def annale_images_dir(annale_id: str) -> str:
    return os.path.join(ANNALES_DIR, annale_id)


def load_annales():
    """Lit tous les *.json du dossier annales/ et remplit le cache."""
    _annales_cache.clear()
    if not os.path.isdir(ANNALES_DIR):
        return
    count = 0
    for name in os.listdir(ANNALES_DIR):
        if not name.endswith(".json"):
            continue
        path = os.path.join(ANNALES_DIR, name)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                annale = json.load(fh)
        except Exception as e:
            print(f"[annales] erreur lecture {name} : {e}", file=sys.stderr)
            continue
        aid = annale.get("id")
        if not isinstance(aid, str) or not SAFE_ID.match(aid):
            print(f"[annales] id manquant ou invalide dans {name}", file=sys.stderr)
            continue
        if not isinstance(annale.get("questions"), list):
            print(f"[annales] champ 'questions' manquant dans {name}", file=sys.stderr)
            continue
        _annales_cache[aid] = annale
        count += 1
    print(f"[annales] {count} annale(s) chargée(s) depuis {ANNALES_DIR}")


def annale_summary(annale):
    """Métadonnées light pour la liste (sans les questions)."""
    return {
        "id": annale.get("id"),
        "title": annale.get("title"),
        "subject": annale.get("subject"),
        "year": annale.get("year"),
        "session": annale.get("session"),
        "questionsCount": len(annale.get("questions") or []),
    }


def annale_for_play(annale):
    """Version envoyée au client en mode 'playing' : retire toutes les bonnes réponses."""
    stripped_questions = []
    for q in annale.get("questions") or []:
        sq = dict(q)
        # Strip champs sensibles
        sq.pop("correctionText", None)
        sq.pop("expectedAnswer", None)
        sq.pop("correctedImage", None)
        # Strip le 'correct' de chaque option
        if isinstance(sq.get("options"), list):
            sq["options"] = [
                {"id": o.get("id"), "text": o.get("text")}
                for o in sq["options"] if isinstance(o, dict)
            ]
        stripped_questions.append(sq)
    return {
        "id": annale.get("id"),
        "title": annale.get("title"),
        "subject": annale.get("subject"),
        "year": annale.get("year"),
        "session": annale.get("session"),
        "questions": stripped_questions,
    }


def _normalise_answer_ids(user_answer):
    if isinstance(user_answer, list):
        return {str(item) for item in user_answer if isinstance(item, (str, int)) and str(item)}
    if isinstance(user_answer, str) and user_answer:
        return {user_answer}
    return set()


def evaluate_question(q, user_answer):
    """Evalue une question et retourne un detail de score compatible avec l'ancien resultat."""
    t = q.get("questionType")
    if t == "QRU" or t == "QRM":
        option_ids = {str(o.get("id")) for o in (q.get("options") or []) if isinstance(o, dict) and o.get("id")}
        correct = {
            str(o.get("id"))
            for o in (q.get("options") or [])
            if isinstance(o, dict) and o.get("id") and o.get("correct")
        }
        user = _normalise_answer_ids(user_answer)
        if option_ids:
            user = user & option_ids

        if not correct:
            return {
                "result": "non-comptee",
                "scoreValue": 0,
                "maxScore": 0,
                "mistakes": None,
                "missedCorrect": [],
                "wrongSelected": [],
                "scoreReason": "aucune bonne reponse definie",
            }

        missed = sorted(correct - user)
        wrong = sorted(user - correct)
        mistakes = len(missed) + len(wrong)

        if not user:
            score = 0
        elif t == "QRU":
            score = 1 if user == correct and len(user) == 1 else 0
        elif mistakes == 0:
            score = 1
        elif mistakes == 1:
            score = 0.5
        elif mistakes == 2:
            score = 0.2
        else:
            score = 0

        if score == 1:
            result = "juste"
        elif score > 0:
            result = "partiel"
        else:
            result = "faux"

        return {
            "result": result,
            "scoreValue": score,
            "maxScore": 1,
            "mistakes": mistakes,
            "missedCorrect": missed,
            "wrongSelected": wrong,
        }

    return {
        "result": "non-comptee",
        "scoreValue": 0,
        "maxScore": 0,
        "mistakes": None,
        "missedCorrect": [],
        "wrongSelected": [],
    }


def grade_annale(annale, answers):
    """Évalue toute l'annale et retourne le détail complet (avec corrections)."""
    if not isinstance(answers, dict):
        answers = {}
    details = []
    juste = faux = partiel = non_comptee = 0
    points = 0.0
    max_points = 0.0
    for q in annale.get("questions") or []:
        qid = q.get("id")
        user_ans = answers.get(qid)
        score = evaluate_question(q, user_ans)
        result = score.get("result")
        points += float(score.get("scoreValue") or 0)
        max_points += float(score.get("maxScore") or 0)
        details.append({
            "qid": qid,
            "questionType": q.get("questionType"),
            "text": q.get("text"),
            "image": q.get("image"),
            "seriesId": q.get("seriesId"),
            "seriesFormat": q.get("seriesFormat"),
            "seriesPosition": q.get("seriesPosition"),
            "userAnswer": user_ans,
            "result": result,
            "scoreValue": score.get("scoreValue"),
            "maxScore": score.get("maxScore"),
            "mistakes": score.get("mistakes"),
            "missedCorrect": score.get("missedCorrect"),
            "wrongSelected": score.get("wrongSelected"),
            "scoreReason": score.get("scoreReason"),
            "options": q.get("options"),  # avec correct
            "answerSource": q.get("answerSource"),
            "expectedAnswer": q.get("expectedAnswer"),
            "correctionText": q.get("correctionText"),
            "correctedImage": q.get("correctedImage"),
        })
        if result == "juste":
            juste += 1
        elif result == "faux":
            faux += 1
        elif result == "partiel":
            partiel += 1
        else:
            non_comptee += 1
    total_notees = int(max_points)
    points = round(points, 2)
    max_points = round(max_points, 2)
    return {
        "finalScore": {
            "juste": juste,
            "faux": faux,
            "partiel": partiel,
            "totalNotees": total_notees,
            "nonComptees": non_comptee,
            "totalQuestions": len(annale.get("questions") or []),
            "points": points,
            "maxPoints": max_points,
            "percentage": round(points * 100 / max_points, 1) if max_points else None,
        },
        "details": details,
    }


def grade_one_question(annale, qid, user_answer):
    """Évalue UNE seule question (mode libre, correction immédiate).
    Retourne le détail complet de cette question (incluant correction)."""
    for q in annale.get("questions") or []:
        if q.get("id") != qid:
            continue
        score = evaluate_question(q, user_answer)
        return {
            "qid": qid,
            "questionType": q.get("questionType"),
            "text": q.get("text"),
            "image": q.get("image"),
            "seriesId": q.get("seriesId"),
            "seriesFormat": q.get("seriesFormat"),
            "seriesPosition": q.get("seriesPosition"),
            "userAnswer": user_answer,
            "result": score.get("result"),
            "scoreValue": score.get("scoreValue"),
            "maxScore": score.get("maxScore"),
            "mistakes": score.get("mistakes"),
            "missedCorrect": score.get("missedCorrect"),
            "wrongSelected": score.get("wrongSelected"),
            "scoreReason": score.get("scoreReason"),
            "options": q.get("options"),
            "answerSource": q.get("answerSource"),
            "expectedAnswer": q.get("expectedAnswer"),
            "correctionText": q.get("correctionText"),
            "correctedImage": q.get("correctedImage"),
        }
    return None


# ────────────────────────────────────────────────────────────────────
# Sessions d'examen (historique des annales jouées)
# ────────────────────────────────────────────────────────────────────

def exam_session_path(session_id: str) -> str:
    return os.path.join(EXAM_SESSIONS_DIR, f"{session_id}.json")


def generate_session_id():
    import secrets
    return "ses_" + secrets.token_urlsafe(8).replace("-", "_").replace("=", "")


def _with_recalculated_session_score(session: dict) -> dict:
    """Retourne une copie de session avec score recalcule depuis l'annale courante."""
    data = dict(session)
    annale_id = data.get("annaleId")
    annale = _annales_cache.get(annale_id) if isinstance(annale_id, str) else None
    if not annale:
        data["scoreRecalculated"] = False
        data["scoreWarning"] = "Annale introuvable : score historique affiche sans recalcul."
        return data

    answers = data.get("answers")
    if not isinstance(answers, dict):
        data["scoreRecalculated"] = False
        data["scoreWarning"] = "Reponses historiques invalides : score historique affiche sans recalcul."
        return data

    stored_details = data.get("details") if isinstance(data.get("details"), list) else []
    stored_qids = [d.get("qid") for d in stored_details if isinstance(d, dict) and d.get("qid")]
    current_qids = [q.get("id") for q in (annale.get("questions") or []) if q.get("id")]

    grading = grade_annale(annale, answers)
    data["finalScore"] = grading.get("finalScore")
    data["details"] = grading.get("details")
    data["scoreRecalculated"] = True
    stored_revision = data.get("annaleRevision")
    current_revision = annale.get("revision") or 0
    if stored_revision is not None and stored_revision != current_revision:
        data["scoreWarning"] = "Annale modifiee depuis cette tentative : score recalcule sur la version actuelle."
    if stored_qids and stored_qids != current_qids:
        data["scoreWarning"] = "Structure de l'annale modifiee depuis cette session : score recalcule sur la version actuelle."
    return data


def exam_session_summary(session: dict) -> dict:
    """Métadonnées light pour la liste de l'historique."""
    fs = session.get("finalScore") or {}
    return {
        "id": session.get("id"),
        "annaleId": session.get("annaleId"),
        "annaleTitle": session.get("annaleTitle"),
        "annaleSubject": session.get("annaleSubject"),
        "annaleYear": session.get("annaleYear"),
        "annaleSession": session.get("annaleSession"),
        "mode": session.get("mode"),
        "submittedAt": session.get("submittedAt"),
        "durationSec": session.get("durationSec"),
        "score": {
            "juste": fs.get("juste"),
            "faux": fs.get("faux"),
            "partiel": fs.get("partiel"),
            "totalNotees": fs.get("totalNotees"),
            "nonComptees": fs.get("nonComptees"),
            "percentage": fs.get("percentage"),
            "totalQuestions": fs.get("totalQuestions"),
            "points": fs.get("points"),
            "maxPoints": fs.get("maxPoints"),
        },
        "scoreRecalculated": session.get("scoreRecalculated"),
        "scoreWarning": session.get("scoreWarning"),
    }


def list_exam_sessions() -> list:
    sessions = []
    if not os.path.isdir(EXAM_SESSIONS_DIR):
        return sessions
    for name in os.listdir(EXAM_SESSIONS_DIR):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(EXAM_SESSIONS_DIR, name), "r", encoding="utf-8") as fh:
                sessions.append(exam_session_summary(_with_recalculated_session_score(json.load(fh))))
        except Exception as e:
            print(f"[exam-sessions] illisible {name} : {e}", file=sys.stderr)
    # Tri : plus récente en premier
    sessions.sort(key=lambda s: s.get("submittedAt") or "", reverse=True)
    return sessions


def serve_annale_image(handler, annale_id: str, filename: str):
    """Sert une image d'annale (sécurisé contre path traversal)."""
    if not SAFE_ID.match(annale_id):
        handler._send_error(400, "annaleId invalide")
        return
    # On valide le filename : que les caractères safe pour un nom de fichier
    if not re.match(r"^[A-Za-z0-9_\-.]{1,200}$", filename) or ".." in filename:
        handler._send_error(400, "filename invalide")
        return
    images_dir = annale_images_dir(annale_id)
    full = os.path.normpath(os.path.join(images_dir, filename))
    # Path traversal check
    if not full.startswith(os.path.normpath(images_dir) + os.sep):
        handler._send_error(403, "chemin interdit")
        return
    if not os.path.isfile(full):
        handler._send_error(404, "image introuvable")
        return
    ext = os.path.splitext(full)[1].lower()
    ctype = MIME.get(ext, "application/octet-stream")
    try:
        with open(full, "rb") as fh:
            data = fh.read()
    except OSError as e:
        handler._send_error(500, f"lecture impossible : {e}")
        return
    handler.send_response(200)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler._cors()
    handler.end_headers()
    handler.wfile.write(data)


# safe_slug, safe_filename, utc_now_iso importés depuis core.storage (Phase 1)


# ────────────────────────────────────────────────────────────────────
# Backups (Phase 0.3) + Audit log (Phase 0.4)
# ────────────────────────────────────────────────────────────────────
# Implémentations déléguées à core.storage (Phase 1 — modularisation).
# Les noms BACKUPS_DIR / audit_log() sont conservés comme façade pour ne pas
# avoir à modifier les call-sites existants.

BACKUPS_DIR = os.path.join(ROOT, "data", "_backups")
_backup_manager = BackupManager(
    data_root=os.path.join(ROOT, "data"),
    backups_dir=BACKUPS_DIR,
    retention=30,
)

_audit_singleton.configure(os.path.join(ROOT, "data", "_audit.jsonl"))

_report_store = ReportStore(os.path.join(ROOT, "data", "_reports.jsonl"))

# Tracker pour éviter de re-créer un backup à chaque PATCH question dans
# une même session serveur. Reset au redémarrage. Le 1er PATCH déclenche
# le backup, les suivants utilisent ce backup-là comme filet de sécurité.
_patch_backup_done = {"done": False}


def audit_log(action, details=None):
    """Façade vers core.storage.audit (singleton). Conservé pour rétrocompat."""
    _audit_singleton.log(action, details)


def create_backup_zip():
    """Façade vers BackupManager.create. Conservé pour rétrocompat."""
    return _backup_manager.create()


def list_backups():
    """Façade vers BackupManager.list_backups."""
    return _backup_manager.list_backups()


def qroc_draft_path(draft_id: str) -> str:
    return os.path.join(QROC_DRAFTS_DIR, f"{draft_id}.json")


def qroc_draft_images_dir(draft_id: str) -> str:
    return os.path.join(QROC_DRAFTS_DIR, draft_id, "images")


def qroc_job_path(job_id: str) -> str:
    return os.path.join(QROC_JOBS_DIR, f"{job_id}.json")


def generate_qroc_id(prefix: str) -> str:
    import secrets
    return f"{prefix}_" + secrets.token_urlsafe(8).replace("-", "_").replace("=", "")


def read_json_file(path: str):
    with QROC_FILE_LOCK:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)


def write_json_file(path: str, data):
    with QROC_FILE_LOCK:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)


def load_qroc_draft(draft_id: str):
    if not SAFE_ID.match(draft_id):
        return None
    path = qroc_draft_path(draft_id)
    if not os.path.isfile(path):
        return None
    return read_json_file(path)


def save_qroc_draft(draft):
    draft["updatedAt"] = utc_now_iso()
    write_json_file(qroc_draft_path(draft["id"]), draft)


def load_qroc_job(job_id: str):
    if not SAFE_ID.match(job_id):
        return None
    path = qroc_job_path(job_id)
    if not os.path.isfile(path):
        return None
    return read_json_file(path)


def save_qroc_job(job):
    job["updatedAt"] = utc_now_iso()
    write_json_file(qroc_job_path(job["id"]), job)


# extract_pdf_text importé depuis core.parsing (Phase 1)


def build_annale_import_prompt(meta, pdf_text):
    annale_id = meta["id"]
    title = meta["title"]
    subject = meta["subject"]
    year = meta["year"]
    session = meta.get("session") or ""

    return f"""Tu es un parseur d'annales medicales EDN/UNESS. Tu dois convertir le texte PDF fourni en JSON strictement valide.

Objectif : produire une annale jouable dans une application locale.

Contraintes obligatoires :
- Reponds uniquement avec un objet JSON valide. Aucun markdown, aucun commentaire.
- Le JSON top-level doit contenir exactement une annale avec id, title, subject, year, session, questions.
- Utilise ces metadonnees sans les modifier :
  - id: {annale_id}
  - title: {title}
  - subject: {subject}
  - year: {year}
  - session: {session}
- Ne reformule pas les enonces, options et corrections. Copie le texte utile le plus fidelement possible.
- N'invente pas de question. Si un morceau est trop ambigu, omets-le plutot que de fabriquer.
- Identifie questionType parmi "QRU", "QRM", "QROC", "ZONE".
- Pour QRU/QRM, chaque option doit avoir id, text, correct. Les cases cochees/officielles sont correct: true.
- Pour QRU, une seule option doit etre correcte. Pour QRM, une ou plusieurs options peuvent etre correctes.
- Pour QROC, renseigne expectedAnswer si le corrige officiel est disponible.
- Pour ZONE/image, mets image avec un nom de fichier si le PDF mentionne explicitement une image, sinon null. Tu ne peux pas extraire l'image depuis le texte.
- Pour DP/KFP, les questions consecutives d'un meme dossier partagent seriesId, seriesFormat, seriesPosition, seriesTotal, vignette et customTitle.
- La vignette d'une question de DP/KFP doit etre cumulative jusqu'a cette question.
- Les QI n'ont pas de seriesId, seriesFormat, seriesPosition, seriesTotal, vignette.
- correctionText doit contenir le corrige/commentaire officiel quand il existe, sinon chaine vide.

Schema JSON attendu :
{{
  "id": "{annale_id}",
  "title": "{title}",
  "subject": "{subject}",
  "year": {year},
  "session": "{session}",
  "questions": [
    {{
      "id": "q1",
      "questionType": "QRU",
      "text": "enonce exact",
      "image": null,
      "options": [
        {{ "id": "A", "text": "option A", "correct": true }},
        {{ "id": "B", "text": "option B", "correct": false }}
      ],
      "correctionText": "corrige officiel",
      "seriesId": null,
      "seriesFormat": null,
      "seriesPosition": null,
      "seriesTotal": null,
      "vignette": null,
      "customTitle": null
    }}
  ]
}}

Texte PDF a convertir :

{pdf_text}
"""


# parse_json_object importé depuis core.deepseek (Phase 1)


# normalize_question_id, int_or_none importés depuis core.text_utils (Phase 1)


def validate_imported_annale(raw_annale, meta):
    if not isinstance(raw_annale, dict):
        raise ValueError("DeepSeek n'a pas renvoye un objet JSON")

    warnings = []
    questions = raw_annale.get("questions")
    if not isinstance(questions, list) or not questions:
        raise ValueError("JSON invalide : questions[] absent ou vide")

    out = {
        "id": meta["id"],
        "title": meta["title"],
        "subject": meta["subject"],
        "year": meta["year"],
        "session": meta.get("session") or None,
        "questions": [],
    }

    seen_ids = set()
    allowed_types = {"QRU", "QRM", "QROC", "ZONE"}
    for index, q in enumerate(questions):
        if not isinstance(q, dict):
            raise ValueError(f"Question {index + 1}: objet attendu")

        qid = normalize_question_id(q.get("id"), index)
        if qid in seen_ids:
            qid = f"{qid}-{index + 1}"
        seen_ids.add(qid)

        qtype = str(q.get("questionType") or "").upper().strip()
        if qtype not in allowed_types:
            raise ValueError(f"{qid}: questionType invalide ({q.get('questionType')!r})")

        text = str(q.get("text") or "").strip()
        if not text:
            raise ValueError(f"{qid}: texte d'enonce manquant")

        answer_source = str(q.get("answerSource") or "source").strip().lower()
        if answer_source not in {"source", "ai"}:
            answer_source = "source"
        normalized = {
            "id": qid,
            "questionType": qtype,
            "answerSource": answer_source,
            "text": text,
            "image": safe_filename(q.get("image")),
            "correctionText": str(q.get("correctionText") or "").strip(),
        }

        if qtype in ("QRU", "QRM"):
            raw_options = q.get("options")
            if not isinstance(raw_options, list) or not raw_options:
                raise ValueError(f"{qid}: options[] requis pour {qtype}")
            options = []
            correct_count = 0
            for opt_index, opt in enumerate(raw_options):
                if not isinstance(opt, dict):
                    raise ValueError(f"{qid}: option {opt_index + 1} invalide")
                opt_id = str(opt.get("id") or chr(65 + opt_index)).strip().upper()
                opt_id = re.sub(r"[^A-Z0-9]", "", opt_id)[:8] or chr(65 + opt_index)
                opt_text = str(opt.get("text") or "").strip()
                if not opt_text:
                    raise ValueError(f"{qid}: option {opt_id} sans texte")
                is_correct = bool(opt.get("correct"))
                if is_correct:
                    correct_count += 1
                options.append({"id": opt_id, "text": opt_text, "correct": is_correct})
            if correct_count == 0:
                warnings.append(f"{qid}: aucune option correcte detectee")
            if qtype == "QRU" and correct_count != 1:
                warnings.append(f"{qid}: QRU avec {correct_count} options correctes")
            normalized["options"] = options

        if qtype == "QROC":
            normalized["expectedAnswer"] = str(q.get("expectedAnswer") or "").strip()
            if not normalized["expectedAnswer"]:
                warnings.append(f"{qid}: QROC sans expectedAnswer")

        if qtype == "ZONE":
            normalized["expectedAnswer"] = str(q.get("expectedAnswer") or "").strip()
            normalized["correctedImage"] = safe_filename(q.get("correctedImage"))

        series_id = q.get("seriesId")
        series_format = str(q.get("seriesFormat") or "").upper().strip()
        if series_id:
            normalized["seriesId"] = safe_slug(series_id, fallback=f"series-{index + 1}")
            normalized["seriesFormat"] = series_format if series_format in {"DP", "KFP"} else "DP"
            normalized["seriesPosition"] = int_or_none(q.get("seriesPosition"))
            normalized["seriesTotal"] = int_or_none(q.get("seriesTotal"))
            normalized["vignette"] = str(q.get("vignette") or "").strip() or None
            normalized["customTitle"] = str(q.get("customTitle") or "").strip() or None
        else:
            normalized["seriesId"] = None
            normalized["seriesFormat"] = None
            normalized["seriesPosition"] = None
            normalized["seriesTotal"] = None
            normalized["vignette"] = None
            normalized["customTitle"] = None

        out["questions"].append(normalized)

    return out, warnings


def call_deepseek_for_annale(api_key, model, prompt):
    body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "Tu convertis des annales medicales en JSON strict. Le mot json est obligatoire : renvoie uniquement du JSON valide."
            },
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "thinking": {"type": "disabled"},
        "temperature": 0,
        "max_tokens": 120000,
        "stream": False,
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urlrequest.Request(
        DEEPSEEK_CHAT_URL,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urlrequest.urlopen(req, timeout=900) as response:
            raw = response.read().decode("utf-8")
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"DeepSeek HTTP {exc.code}: {detail[:1200]}") from exc
    except urlerror.URLError as exc:
        raise RuntimeError(f"appel DeepSeek impossible : {exc.reason}") from exc

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"reponse DeepSeek non JSON : {raw[:500]}") from exc

    choices = payload.get("choices")
    if not choices:
        raise RuntimeError("DeepSeek n'a pas renvoye de choices[]")
    choice = choices[0]
    finish_reason = choice.get("finish_reason")
    if finish_reason == "length":
        raise RuntimeError("reponse DeepSeek tronquee : augmente max_tokens ou decoupe le PDF")
    content = (choice.get("message") or {}).get("content")
    if not content:
        raise RuntimeError("DeepSeek a renvoye un contenu vide")
    return content, payload.get("usage"), finish_reason


# qroc_source_warning, is_blocking_severity importés depuis core.text_utils (Phase 1)


# source_block_stats, validate_source_block, is_qroc_block_start
# importés depuis core.qroc_blocks (Phase 1)


def parse_qroc_source_pdf(pdf_bytes, meta, draft_id, filename=None, profile="qroc"):
    """Wrapper local : injecte le images_dir cible depuis qroc_draft_images_dir."""
    return _parse_qroc_source_pdf_core(
        pdf_bytes, meta, draft_id,
        images_dir=qroc_draft_images_dir(draft_id),
        filename=filename,
        profile=profile,
    )


def normalize_source_blocks_for_patch(source_blocks):
    if not isinstance(source_blocks, list) or not source_blocks:
        raise ValueError("sourceBlocks[] absent ou vide")
    out = []
    for index, raw in enumerate(source_blocks):
        if not isinstance(raw, dict):
            raise ValueError(f"bloc {index + 1}: objet attendu")
        block_id = safe_slug(raw.get("id"), fallback=f"sb{index + 1}", max_len=40)
        block = {
            "id": block_id,
            "title": str(raw.get("title") or f"Bloc {index + 1}").strip()[:160],
            "pages": [int(p) for p in raw.get("pages") or [] if str(p).isdigit()],
            "rawText": str(raw.get("rawText") or raw.get("cleanText") or "").strip(),
            "cleanText": str(raw.get("cleanText") or raw.get("rawText") or "").strip(),
            "ignored": bool(raw.get("ignored")),
            "warningsOverride": raw.get("warningsOverride") if raw.get("warningsOverride") == "accepted" else None,
            "images": raw.get("images") if isinstance(raw.get("images"), list) else [],
        }
        validate_source_block(block)
        out.append(block)
    return out


def build_qroc_generation_prompt(draft, block):
    payload = {
        "annale": draft.get("meta"),
        "sourceBlock": {
            "id": block.get("id"),
            "title": block.get("title"),
            "pages": block.get("pages"),
            "text": block.get("cleanText"),
            "images": [
                {"id": img.get("id"), "filename": img.get("filename"), "page": img.get("page")}
                for img in block.get("images") or []
            ],
        },
    }
    return (
        "Tu transformes un bloc medical en questions d'entrainement EDN-like.\n"
        "Le bloc source peut etre SOIT un corrige (enonces + reponses/correction), "
        "SOIT un simple sujet d'examen (enonces SEULS, sans aucune reponse).\n"
        "Reponds uniquement avec un objet JSON valide.\n\n"
        "PROVENANCE DE LA REPONSE (answerSource) — REGLE CENTRALE:\n"
        "- Pour CHAQUE question, indique answerSource:\n"
        '  - "source" : la reponse/correction est presente dans le bloc → tu l\'utilises fidelement.\n'
        '  - "ai" : le bloc ne contient PAS la reponse a cette question (sujet sans corrige) → '
        "tu reponds a partir de tes connaissances medicales validees (referentiels EDN, colleges).\n"
        '- Par DEFAUT answerSource="source". N\'utilise "ai" QUE si aucune reponse n\'est visible dans le bloc pour cette question.\n'
        '- En cas de doute, traite comme "source" et laisse expectedAnswer vide plutot que d\'inventer.\n\n'
        "OBJECTIF FORMAT (PRIORITAIRE):\n"
        "- Au moins 85% des questions doivent etre QRU (1 bonne reponse) ou QRM (plusieurs bonnes).\n"
        "- Construis activement des options distracteurs plausibles : alternatives diagnostiques, traitements voisins, pieges classiques de l'EDN, items proches.\n"
        "- Une question difficile n'est PAS une excuse pour basculer en QROC : transforme-la en QRU/QRM avec 4 a 6 options.\n"
        "- QROC reservee uniquement aux : calculs biologiques chiffres, formules medicales, valeurs numeriques exactes, citations textuelles obligatoires.\n\n"
        'REGLES MEDICALES — si answerSource="source":\n'
        "- Le bloc source est la seule source de verite.\n"
        "- Interdiction d'inventer constantes biologiques, symptomes, antecedents, examens, traitements ou diagnostics absents du bloc.\n"
        "- Interdiction de creer des options pieges non justifiees par le texte source.\n"
        "- sourceRefs: liste d'extraits exacts du bloc qui justifient la reponse.\n\n"
        'REGLES MEDICALES — si answerSource="ai" (sujet sans corrige):\n'
        "- Reponds avec la reponse medicale de reference correcte et consensuelle (referentiels EDN/colleges).\n"
        "- N'utilise PAS de donnees cliniques (constantes, antecedents) absentes de l'enonce : reste fidele a l'enonce de la question.\n"
        "- Les distracteurs doivent etre medicalement plausibles mais faux pour cette question.\n"
        "- correctionText: justification medicale concise. sourceRefs peut etre vide (la justification vient de tes connaissances, pas du bloc).\n"
        "- Ne fabrique pas de fausse certitude : si la reponse de reference est reellement ambigue, garde une QROC avec expectedAnswer concis.\n\n"
        "STRUCTURE ATTENDUE:\n"
        "{\n"
        '  "questions": [\n'
        "    {\n"
        '      "questionType": "QRU|QRM|QROC",\n'
        '      "answerSource": "source|ai",\n'
        '      "text": "enonce",\n'
        '      "image": null,\n'
        '      "options": [{"id":"A","text":"...","correct":true}],\n'
        '      "expectedAnswer": "pour QROC seulement",\n'
        '      "correctionText": "correction justifiee",\n'
        '      "seriesId": "dp-sb1|null",\n'
        '      "seriesFormat": "DP|KFP|null",\n'
        '      "seriesPosition": 1,\n'
        '      "seriesTotal": 3,\n'
        '      "vignette": "cas clinique cumulatif ou null",\n'
        '      "customTitle": "titre court ou null",\n'
        '      "sourceRefs": ["extrait exact du bloc si answerSource=source"]\n'
        "    }\n"
        "  ],\n"
        '  "warnings": []\n'
        "}\n\n"
        'EXEMPLE answerSource="source" (corrige present, a imiter pour le format) :\n'
        "{\n"
        '  "questionType": "QRU",\n'
        '  "answerSource": "source",\n'
        '  "text": "Quel est le diagnostic le plus probable ?",\n'
        '  "options": [\n'
        '    {"id":"A","text":"Infarctus du myocarde","correct":true},\n'
        '    {"id":"B","text":"Embolie pulmonaire","correct":false},\n'
        '    {"id":"C","text":"Dissection aortique","correct":false},\n'
        '    {"id":"D","text":"Pericardite aigue","correct":false}\n'
        "  ],\n"
        '  "correctionText": "Le sus-decalage en V1-V4 + douleur typique evoque un IDM anterieur (cf bloc).",\n'
        '  "sourceRefs": ["sus-decalage ST en V1-V4", "douleur thoracique typique"]\n'
        "}\n\n"
        'EXEMPLE answerSource="ai" (sujet sans corrige, reponse de reference) :\n'
        "{\n"
        '  "questionType": "QRU",\n'
        '  "answerSource": "ai",\n'
        '  "text": "Quel est le temoin biologique de l\'insulino-secretion endogene ?",\n'
        '  "options": [\n'
        '    {"id":"A","text":"Peptide C","correct":true},\n'
        '    {"id":"B","text":"HbA1c","correct":false},\n'
        '    {"id":"C","text":"Glycemie a jeun","correct":false},\n'
        '    {"id":"D","text":"Fructosamine","correct":false}\n'
        "  ],\n"
        '  "correctionText": "Le peptide C est co-secrete avec l\'insuline endogene (clive de la pro-insuline) et absent des insulines injectees : c\'est le marqueur de l\'insulino-secretion residuelle.",\n'
        '  "sourceRefs": []\n'
        "}\n\n"
        "CHOIX DE FORMAT:\n"
        "- Si le bloc contient une vignette clinique suivie de questions progressives: DP ou KFP.\n"
        "- Si les elements sont decousus/theoriques: serie de QI.\n"
        "- Volume cible: 3 a 6 questions par bloc.\n"
        "- QRM: 2 a 15 propositions maximum, ids A a O.\n\n"
        "DONNEES:\n"
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
    )


def build_faithful_transcription_prompt(draft, block):
    """
    Prompt du mode « Autre » (profile=faithful) : transcription FIDÈLE 1:1 d'un bloc de
    sujet d'examen, SANS expansion ni fusion (contrairement a build_qroc_generation_prompt
    qui fabrique 3 a 6 questions par bloc). Detecte le type reel de chaque question et,
    si la reponse est absente du bloc, la genere depuis les connaissances medicales (answerSource=ai).
    """
    payload = {
        "annale": draft.get("meta"),
        "sourceBlock": {
            "id": block.get("id"),
            "title": block.get("title"),
            "pages": block.get("pages"),
            "text": block.get("cleanText"),
            "images": [
                {"id": img.get("id"), "filename": img.get("filename"), "page": img.get("page")}
                for img in block.get("images") or []
            ],
        },
    }
    return (
        "Tu transcris FIDELEMENT un bloc d'un sujet d'examen medical en questions d'entrainement.\n"
        "Reponds uniquement avec un objet JSON valide.\n\n"
        "FIDELITE (REGLE ABSOLUE):\n"
        "- Reproduis CHAQUE question reellement presente dans le bloc, une pour une, dans l'ordre.\n"
        "- N'INVENTE PAS de nouvelle question. NE FUSIONNE PAS deux questions. NE DECOUPE PAS une question en plusieurs.\n"
        "- Ne reformule pas l'enonce : recopie le texte utile le plus fidelement possible.\n"
        "- Si un fragment est un en-tete, une consigne administrative ou une page de garde, ignore-le (ce n'est pas une question).\n\n"
        "DETECTION DU TYPE (d'apres la forme reelle de la question):\n"
        "- QRU : propositions listees, UNE seule correcte.\n"
        "- QRM : propositions listees, PLUSIEURS correctes.\n"
        "- QROC : question ouverte courte, sans propositions (calcul, valeur, citation, definition).\n"
        "- Ne convertis PAS une QROC ouverte en QCM et inversement : respecte le format d'origine.\n\n"
        "BONNE REPONSE OBLIGATOIRE (une QRU/QRM sans bonne reponse est inutilisable):\n"
        "- Toute QRU a EXACTEMENT une option correct:true ; toute QRM en a AU MOINS une. Ne renvoie JAMAIS une QRU/QRM sans bonne reponse cochee.\n"
        "- Si le bloc indique la reponse (corrige, 'Reponse : X', case cochee, asterisque, soulignement, 'bonne reponse'), coche l'option correspondante (answerSource=source).\n"
        "- Sinon, choisis la bonne reponse selon tes connaissances medicales et coche-la (answerSource=ai).\n"
        "- Si vraiment aucune option ne peut etre tranchee, convertis la question en QROC (questionType QROC, expectedAnswer = la reponse) plutot que de laisser une QCM sans bonne reponse.\n\n"
        "PROVENANCE DE LA REPONSE (answerSource) — pour CHAQUE question:\n"
        '- "source" : la reponse/correction figure dans le bloc → utilise-la fidelement.\n'
        '- "ai" : le bloc ne contient PAS la reponse → donne la reponse medicale de reference '
        "(referentiels EDN/colleges), correctionText = justification concise, sourceRefs vide.\n"
        '- Par defaut "source". En cas de doute, "source" + expectedAnswer vide plutot qu\'inventer.\n'
        "- Pour les QRU/QRM dont seules les propositions sont donnees (sujet sans corrige), marque les bonnes options selon tes connaissances et answerSource=\"ai\".\n\n"
        "STRUCTURE ATTENDUE (identique au pipeline de generation):\n"
        "{\n"
        '  "questions": [\n'
        "    {\n"
        '      "questionType": "QRU|QRM|QROC",\n'
        '      "answerSource": "source|ai",\n'
        '      "text": "enonce exact",\n'
        '      "image": null,\n'
        '      "options": [{"id":"A","text":"...","correct":true}],\n'
        '      "expectedAnswer": "pour QROC seulement",\n'
        '      "correctionText": "correction / justification",\n'
        '      "seriesId": null,\n'
        '      "seriesFormat": null,\n'
        '      "seriesPosition": null,\n'
        '      "seriesTotal": null,\n'
        '      "vignette": null,\n'
        '      "customTitle": null,\n'
        '      "sourceRefs": ["extrait exact si answerSource=source"]\n'
        "    }\n"
        "  ],\n"
        '  "warnings": []\n'
        "}\n\n"
        "- Si plusieurs questions partagent une meme vignette clinique (dossier progressif), tu peux "
        "renseigner seriesId/seriesFormat (DP|KFP)/seriesPosition/seriesTotal et la vignette cumulative.\n"
        "- QRM: 2 a 15 propositions maximum, ids A a O.\n\n"
        "DONNEES:\n"
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
    )


def build_qroc_check_prompt(block, questions):
    payload = {"sourceBlock": block.get("cleanText"), "questions": questions}
    return (
        "Tu es controleur qualite medical. Reponds uniquement en JSON.\n"
        "Verifie uniquement que chaque question est strictement justifiee par le bloc source.\n"
        "Le bloc source est le corrige officiel et doit etre traite comme source de verite pour ce controle.\n"
        "N'utilise pas tes connaissances medicales externes pour contredire ou corriger le bloc source.\n"
        "Signale en severity=error uniquement les symptomes, antecedents, constantes biologiques, diagnostics, examens, traitements ou pieges presents dans la question mais absents du bloc source.\n"
        "Si une affirmation medicale est discutable mais apparait explicitement dans le bloc source, ne la signale pas en erreur.\n"
        "Si tout est acceptable, retourne issues: [] ; n'ecris pas de messages 'aucun probleme'.\n"
        "Schema: {\"issues\":[{\"questionId\":\"q1\",\"severity\":\"warning|error\",\"message\":\"...\",\"sourceRef\":\"extrait si possible\"}]}\n\n"
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
    )


# call_deepseek_json importé depuis core.deepseek (Phase 1)


def mock_qroc_generation(block):
    text = clean_pdf_text(block.get("cleanText") or "")
    title = block.get("title") or block.get("id")
    first_sentence = text[:220] or "Bloc source"
    ref = first_sentence[:160]
    sid = f"dp-{safe_slug(block.get('id'), fallback='bloc')}"
    return {
        "questions": [
            {
                "questionType": "QROC",
                "answerSource": "ai",
                "text": f"Quel est le point cle a retenir dans {title} ?",
                "expectedAnswer": ref,
                "correctionText": ref,
                "seriesId": None,
                "seriesFormat": None,
                "seriesPosition": None,
                "seriesTotal": None,
                "vignette": None,
                "customTitle": None,
                "sourceRefs": [ref],
            },
            {
                "questionType": "QRM",
                "answerSource": "source",
                "text": "Quelles propositions sont soutenues par le corrige source ?",
                "options": [
                    {"id": "A", "text": ref[:90] or "Element cite dans le corrige", "correct": True},
                    {"id": "B", "text": "Proposition non documentee par ce bloc", "correct": False},
                    {"id": "C", "text": "Element a verifier dans le corrige officiel", "correct": False},
                ],
                "correctionText": ref,
                "seriesId": sid,
                "seriesFormat": "DP",
                "seriesPosition": 1,
                "seriesTotal": 2,
                "vignette": first_sentence,
                "customTitle": title,
                "sourceRefs": [ref],
            },
            {
                "questionType": "QRU",
                "answerSource": "source",
                "text": "Quelle source doit justifier la reponse ?",
                "options": [
                    {"id": "A", "text": "Le bloc QROC corrige", "correct": True},
                    {"id": "B", "text": "Une connaissance externe non citee", "correct": False},
                ],
                "correctionText": "La conversion doit rester justifiee par le bloc source.",
                "seriesId": sid,
                "seriesFormat": "DP",
                "seriesPosition": 2,
                "seriesTotal": 2,
                "vignette": first_sentence,
                "customTitle": title,
                "sourceRefs": [ref],
            },
        ],
        "warnings": ["mock generation"],
    }


def normalize_qroc_generated_questions(raw_questions, block, start_index=0):
    """
    Retourne (questions, warnings, errors, infos) ou :
    - errors : echecs bloquants (schema, options manquantes, etc.) → severity 'error'
    - warnings : alertes a verifier mais non bloquantes → severity 'warning'
    - infos : ecarts cosmetiques (sourceRef variation, expectedAnswer vide, etc.) → severity 'info'
              masques par defaut dans l'UI
    """
    if isinstance(raw_questions, dict):
        raw_questions = raw_questions.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        raise ValueError("DeepSeek n'a pas renvoye questions[]")

    source_text = block.get("cleanText") or ""
    questions = []
    warnings = []
    errors = []
    infos = []
    seen_ids = set()
    for index, raw in enumerate(raw_questions):
        if not isinstance(raw, dict):
            errors.append(f"question {index + 1}: objet invalide")
            continue
        qid = normalize_question_id(raw.get("id"), start_index + index)
        if qid in seen_ids:
            qid = f"{qid}-{index + 1}"
        seen_ids.add(qid)
        qtype = str(raw.get("questionType") or "").upper().strip()
        if qtype not in {"QRU", "QRM", "QROC"}:
            errors.append(f"{qid}: type invalide {qtype!r}")
            continue
        text = str(raw.get("text") or "").strip()
        if not text:
            errors.append(f"{qid}: enonce vide")
            continue
        answer_source = str(raw.get("answerSource") or "source").strip().lower()
        if answer_source not in {"source", "ai"}:
            answer_source = "source"
        question = {
            "id": qid,
            "questionType": qtype,
            "answerSource": answer_source,
            "text": text,
            "image": safe_filename(raw.get("image")),
            "correctionText": str(raw.get("correctionText") or "").strip(),
            "seriesId": None,
            "seriesFormat": None,
            "seriesPosition": None,
            "seriesTotal": None,
            "vignette": None,
            "customTitle": None,
            "sourceRefs": [str(ref).strip() for ref in raw.get("sourceRefs") or [] if str(ref).strip()],
            "_sourceBlockId": safe_slug(raw.get("_sourceBlockId") or raw.get("sourceBlockId") or block.get("id"), fallback=str(block.get("id") or "source")),
        }
        if qtype in {"QRU", "QRM"}:
            options = []
            for opt_index, opt in enumerate(raw.get("options") or []):
                if not isinstance(opt, dict):
                    continue
                opt_id = str(opt.get("id") or (QROC_OPTION_IDS[opt_index] if opt_index < len(QROC_OPTION_IDS) else f"O{opt_index + 1}")).strip().upper()
                opt_id = re.sub(r"[^A-Z0-9]", "", opt_id)[:8] or QROC_OPTION_IDS[min(opt_index, len(QROC_OPTION_IDS) - 1)]
                opt_text = str(opt.get("text") or "").strip()
                if opt_text:
                    options.append({"id": opt_id, "text": opt_text, "correct": bool(opt.get("correct"))})
            if not options:
                errors.append(f"{qid}: options absentes")
            if len(options) > 15:
                infos.append(f"{qid}: QRM/QRU tronquee a 15 options")
                options = options[:15]
            correct_count = sum(1 for opt in options if opt.get("correct"))
            if correct_count == 0:
                errors.append(f"{qid}: aucune option correcte")
            if qtype == "QRU" and correct_count != 1:
                errors.append(f"{qid}: QRU avec {correct_count} bonnes reponses")
            if qtype == "QRM" and len(options) >= 2 and correct_count == len(options):
                infos.append(f"{qid}: QRM tout-vrai convertie en QROC (aucun distracteur source)")
                question["questionType"] = "QROC"
                question["options"] = None
                question["expectedAnswer"] = "\n".join(opt["text"] for opt in options if opt.get("text"))
            else:
                question["options"] = options
        if qtype == "QROC":
            question["expectedAnswer"] = str(raw.get("expectedAnswer") or "").strip()
            if not question["expectedAnswer"] and answer_source != "ai":
                infos.append(f"{qid}: QROC sans expectedAnswer (a completer manuellement)")

        if answer_source == "ai":
            infos.append(f"{qid}: reponse generee par IA (corrige absent du PDF) - a verifier")

        series_id = raw.get("seriesId")
        if series_id:
            block_slug = safe_slug(block.get("id"), fallback="bloc")
            series_slug = safe_slug(series_id, fallback=f"series-{block_slug}")
            if not series_slug.startswith(f"{block_slug}-"):
                series_slug = f"{block_slug}-{series_slug}"
            question["seriesId"] = series_slug
            series_format = str(raw.get("seriesFormat") or "DP").upper().strip()
            question["seriesFormat"] = series_format if series_format in {"DP", "KFP"} else "DP"
            question["seriesPosition"] = int_or_none(raw.get("seriesPosition"))
            question["seriesTotal"] = int_or_none(raw.get("seriesTotal"))
            question["vignette"] = str(raw.get("vignette") or "").strip() or None
            question["customTitle"] = str(raw.get("customTitle") or block.get("title") or "").strip() or None

        if not question["sourceRefs"]:
            # sourceRefs absent : warning (a verifier) plutot qu'erreur, car la question peut etre correcte sans
            warnings.append(f"{qid}: sourceRefs absent")
        else:
            for ref in question["sourceRefs"]:
                if ref not in source_text:
                    # Variation lexicale frequente, pas une vraie erreur
                    infos.append(f"{qid}: sourceRef non retrouve exactement (variation lexicale possible)")
        questions.append(question)

    # Anti-biais : DeepSeek place quasi-systématiquement les bonnes réponses
    # en début. Shuffle aléatoire avec réassignation A→E avant publication.
    shuffle_questions_options(questions)

    return questions, warnings, errors, infos


def apply_qroc_check_issues(questions, issues):
    """
    Retourne (warnings, errors, infos).
    La QA DeepSeek a un fort taux de faux positifs : ses issues sont rangees en 'info'
    (masquees par defaut dans l'UI). Seules les severites 'error' explicites du LLM
    remontent en warning (jamais en erreur bloquante : seuls les echecs techniques bloquent).
    """
    warnings = []
    errors = []
    infos = []
    if not isinstance(issues, list):
        return warnings, errors, infos
    skip_tokens = (
        "aucun probleme", "aucune erreur", "aucune invention", "pas de probleme",
        "ras", "tout est correct", "tout est coherent", "rien a signaler",
        "aucune incoherence", "aucune anomalie",
    )
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        message = str(issue.get("message") or "Issue controle qualite").strip()
        qid = str(issue.get("questionId") or "?")
        severity = str(issue.get("severity") or "warning").lower()
        folded_message = fold_ascii(message)
        if any(token in folded_message for token in skip_tokens):
            continue
        line = f"{qid}: {message}"
        # Si le LLM a explicitement marque severity=error, on remonte en warning
        # (visible mais non bloquant). Sinon : info (masque par defaut).
        if severity == "error":
            warnings.append(line)
        else:
            infos.append(line)
    return warnings, errors, infos


def recompute_generated_series(questions):
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


def draft_to_publish_annale(draft):
    meta = draft.get("meta") or {}
    raw_questions = draft.get("generatedQuestions") or []
    if not raw_questions:
        raise ValueError("aucune question generee")
    questions = []
    source_image_dir = qroc_draft_images_dir(draft["id"])
    target_image_dir = annale_images_dir(meta["annaleId"])
    for index, raw in enumerate(raw_questions):
        question = dict(raw)
        question["id"] = normalize_question_id(question.get("id"), index)
        for internal_key in ("sourceRefs", "_sourceBlockId", "warnings", "qaIssues"):
            question.pop(internal_key, None)
        if question.get("image"):
            image_name = safe_filename(question.get("image"))
            question["image"] = image_name
            if image_name:
                source = os.path.join(source_image_dir, image_name)
                if os.path.isfile(source):
                    os.makedirs(target_image_dir, exist_ok=True)
                    shutil.copy2(source, os.path.join(target_image_dir, image_name))
        questions.append(question)
    recompute_generated_series(questions)
    annale = {
        "id": meta["annaleId"],
        "title": meta["title"],
        "subject": meta["subject"],
        "year": meta["year"],
        "session": meta.get("session"),
        "questions": questions,
    }
    validation_meta = {
        "id": meta["annaleId"],
        "title": meta["title"],
        "subject": meta["subject"],
        "year": meta["year"],
        "session": meta.get("session"),
    }
    normalized, warnings = validate_imported_annale(annale, validation_meta)
    return normalized, warnings


def renumber_qroc_generated_questions(questions):
    out = []
    for index, question in enumerate(questions):
        item = dict(question)
        previous_id = str(item.get("id") or "").strip()
        next_id = f"q{index + 1}"
        if previous_id and previous_id != next_id:
            patched_warnings = []
            for warning in item.get("warnings") or []:
                if isinstance(warning, str) and warning.startswith(f"{previous_id}:"):
                    patched_warnings.append(f"{next_id}:{warning[len(previous_id) + 1:]}")
                else:
                    patched_warnings.append(warning)
            item["warnings"] = patched_warnings
        item["id"] = next_id
        out.append(item)
    return out


def merge_qroc_block_results(results_by_index):
    questions = []
    warnings = []
    errors = []
    infos = []
    usage = []
    for index in sorted(results_by_index):
        result = results_by_index[index]
        questions.extend(result.get("questions") or [])
        warnings.extend(result.get("warnings") or [])
        errors.extend(result.get("errors") or [])
        infos.extend(result.get("infos") or [])
        usage.extend(result.get("usage") or [])
    return renumber_qroc_generated_questions(questions), warnings, errors, infos, usage


def qroc_job_worker():
    while True:
        job_input = QROC_JOB_QUEUE.get()
        try:
            run_qroc_generation_job(job_input)
        except Exception:
            traceback.print_exc()
        finally:
            QROC_JOB_QUEUE.task_done()


def start_qroc_worker():
    global QROC_WORKER_STARTED
    with QROC_JOB_LOCK:
        if QROC_WORKER_STARTED:
            return
        for index in range(QROC_JOB_WORKER_COUNT):
            worker = threading.Thread(
                target=qroc_job_worker,
                name=f"qroc-conversion-worker-{index + 1}",
                daemon=True,
            )
            worker.start()
        QROC_WORKER_STARTED = True


def mark_interrupted_qroc_jobs():
    os.makedirs(QROC_JOBS_DIR, exist_ok=True)
    for name in os.listdir(QROC_JOBS_DIR):
        if not name.endswith(".json"):
            continue
        path = os.path.join(QROC_JOBS_DIR, name)
        try:
            job = read_json_file(path)
        except Exception:
            continue
        if job.get("status") in {"queued", "running", "generating", "checking", "cancelling"}:
            job["status"] = "interrupted"
            job["error"] = "Serveur redemarre pendant la generation. Relance depuis le brouillon."
            save_qroc_job(job)


def enqueue_qroc_generation(draft_id, api_key, model, mock=False, skip_qa=False, block_ids=None):
    start_qroc_worker()
    job_id = generate_qroc_id("job")
    safe_block_ids = [safe_slug(block_id, fallback="") for block_id in (block_ids or [])]
    safe_block_ids = [block_id for block_id in safe_block_ids if block_id]
    job = {
        "id": job_id,
        "draftId": draft_id,
        "status": "queued",
        "progress": {"current": 0, "total": 0, "phase": "pending", "currentBlockId": None, "activeBlockIds": [], "blockStates": {}},
        "usage": [],
        "errors": [],
        "warnings": [],
        "workerConfig": {
            "jobWorkers": QROC_JOB_WORKER_COUNT,
            "blockWorkers": QROC_BLOCK_WORKERS,
            "deepseekMaxConcurrentCalls": DEEPSEEK_MAX_CONCURRENT_CALLS,
            "skipQa": bool(skip_qa),
            "blockIds": safe_block_ids,
        },
        "createdAt": utc_now_iso(),
        "updatedAt": utc_now_iso(),
    }
    save_qroc_job(job)
    QROC_JOB_QUEUE.put({
        "jobId": job_id,
        "draftId": draft_id,
        "apiKey": api_key,
        "model": model,
        "mock": bool(mock),
        "skipQa": bool(skip_qa),
        "blockIds": safe_block_ids,
    })
    return job


def run_qroc_generation_job(job_input):
    job_id = job_input["jobId"]
    draft_id = job_input["draftId"]
    api_key = job_input.get("apiKey")
    model = job_input.get("model") or "deepseek-v4-flash"
    mock = bool(job_input.get("mock"))
    skip_qa = bool(job_input.get("skipQa"))
    requested_block_ids = {safe_slug(block_id, fallback="") for block_id in (job_input.get("blockIds") or [])}
    requested_block_ids.discard("")
    job = load_qroc_job(job_id)
    draft = load_qroc_draft(draft_id)
    if not job or not draft:
        return
    profile = draft.get("profile") or "qroc"
    if profile == "faithful":
        # Transcription fidele : le QA "bloc source = corrige officiel = verite" n'a pas de sens.
        skip_qa = True
    all_blocks = [block for block in draft.get("sourceBlocks") or [] if not block.get("ignored")]
    if requested_block_ids:
        blocks = [block for block in all_blocks if safe_slug(block.get("id"), fallback="") in requested_block_ids]
    else:
        blocks = all_blocks
    total_blocks = len(blocks)
    block_states = {block.get("id") or f"block-{index + 1}": "pending" for index, block in enumerate(blocks)}
    active_blocks = set()
    results_by_index = {}
    state_lock = threading.Lock()
    existing_questions = []
    existing_warnings = []
    existing_errors = []
    existing_infos = []
    if requested_block_ids:
        existing_questions = [
            question for question in draft.get("generatedQuestions") or []
            if safe_slug(question.get("_sourceBlockId"), fallback="") not in requested_block_ids
        ]
        previous_report = draft.get("generationReport") or {}
        def keep_report_line(line):
            prefix = str(line or "").split(":", 1)[0]
            return safe_slug(prefix, fallback="") not in requested_block_ids
        existing_warnings = [line for line in previous_report.get("warnings") or [] if keep_report_line(line)]
        existing_errors = [line for line in previous_report.get("errors") or [] if keep_report_line(line)]
        existing_infos = [line for line in previous_report.get("infos") or [] if keep_report_line(line)]

    def save_state(phase="running", current_block_id=None):
        current = len(results_by_index)
        job["progress"] = {
            "current": current,
            "total": total_blocks,
            "phase": phase,
            "currentBlockId": current_block_id,
            "activeBlockIds": sorted(active_blocks),
            "blockStates": dict(block_states),
        }
        save_qroc_job(job)

    def persist_merged_state(final_phase=None):
        questions, warnings, errors, infos, usage = merge_qroc_block_results(results_by_index)
        draft["generatedQuestions"] = renumber_qroc_generated_questions(existing_questions + questions)
        draft["generationReport"] = {
            "warnings": existing_warnings + warnings,
            "errors": existing_errors + errors,
            "infos": existing_infos + infos,
        }
        draft["status"] = "generated-with-errors" if draft["generationReport"]["errors"] else ("generated" if len(results_by_index) == total_blocks else "generating")
        recompute_generated_series(draft["generatedQuestions"])
        job["usage"] = usage
        job["errors"] = errors
        save_state(final_phase or ("done" if len(results_by_index) == total_blocks else "running"))
        save_qroc_draft(draft)

    def process_block(index, block):
        block_id = block.get("id") or f"block-{index + 1}"
        if job_id in QROC_CANCEL_REQUESTS:
            return {"index": index, "blockId": block_id, "questions": [], "warnings": [], "errors": [f"{block_id}: job annule avant generation"], "infos": [], "usage": []}
        with state_lock:
            active_blocks.add(block_id)
            block_states[block_id] = "generating"
            save_state("generating", block_id)
        try:
            if mock:
                generated = mock_qroc_generation(block)
                usage = {"mock": True}
            else:
                prompt = (
                    build_faithful_transcription_prompt(draft, block)
                    if profile == "faithful"
                    else build_qroc_generation_prompt(draft, block)
                )
                generated, usage = call_deepseek_json(api_key, model, prompt)
            questions, warnings, errors, infos = normalize_qroc_generated_questions(
                generated.get("questions") if isinstance(generated, dict) else generated,
                block,
                index * 100,
            )
            usage_entries = [{"blockId": block_id, "generation": usage}]

            if job_id in QROC_CANCEL_REQUESTS:
                errors.append(f"{block_id}: job annule apres generation")
            elif skip_qa:
                with state_lock:
                    block_states[block_id] = "done"
                    save_state("running", block_id)
                usage_entries.append({"blockId": block_id, "check": {"skipped": True}})
            else:
                # Le QA "bloc source = corrige officiel = verite" ne s'applique PAS aux
                # questions generees par IA (answerSource=ai) : leur reponse vient des
                # connaissances medicales, pas du bloc. On ne controle que les questions source.
                source_questions = [q for q in questions if q.get("answerSource") != "ai"]
                if not source_questions:
                    with state_lock:
                        block_states[block_id] = "done"
                        save_state("running", block_id)
                    usage_entries.append({"blockId": block_id, "check": {"skipped": "ai-generated"}})
                else:
                    with state_lock:
                        block_states[block_id] = "checking"
                        save_state("checking", block_id)
                    if mock:
                        check_payload = {"issues": []}
                        check_usage = {"mock": True}
                    else:
                        check_payload, check_usage = call_deepseek_json(api_key, model, build_qroc_check_prompt(block, source_questions), max_tokens=8000)
                    qa_warnings, qa_errors, qa_infos = apply_qroc_check_issues(source_questions, check_payload.get("issues") if isinstance(check_payload, dict) else [])
                    warnings.extend(qa_warnings)
                    errors.extend(qa_errors)
                    infos.extend(qa_infos)
                    usage_entries.append({"blockId": block_id, "check": check_usage})

            for question in questions:
                question["warnings"] = [warning for warning in warnings if warning.startswith(f"{question['id']}:")]
            return {
                "index": index,
                "blockId": block_id,
                "questions": questions,
                "warnings": [f"{block_id}: {warning}" for warning in warnings],
                "errors": [f"{block_id}: {error}" for error in errors],
                "infos": [f"{block_id}: {info}" for info in infos],
                "usage": usage_entries,
            }
        except Exception as exc:
            return {
                "index": index,
                "blockId": block_id,
                "questions": [],
                "warnings": [],
                "errors": [f"{block_id}: {exc}"],
                "infos": [],
                "usage": [],
            }

    blocking = [
        f"{block.get('id')}: {warning.get('message')}"
        for block in blocks
        for warning in block.get("warnings") or []
        if warning.get("blocking")
    ]
    if blocking:
        job["status"] = "error"
        job["errors"] = blocking
        job["progress"] = {"current": 0, "total": total_blocks, "phase": "blocked", "currentBlockId": None, "activeBlockIds": [], "blockStates": block_states}
        save_qroc_job(job)
        return

    if requested_block_ids and not blocks:
        job["status"] = "error"
        job["errors"] = [f"aucun bloc trouve pour retry: {', '.join(sorted(requested_block_ids))}"]
        job["progress"] = {"current": 0, "total": 0, "phase": "blocked", "currentBlockId": None, "activeBlockIds": [], "blockStates": {}}
        save_qroc_job(job)
        return

    job["status"] = "running"
    job["progress"] = {"current": 0, "total": total_blocks, "phase": "pending", "currentBlockId": None, "activeBlockIds": [], "blockStates": block_states}
    job["workerConfig"] = {
        "jobWorkers": QROC_JOB_WORKER_COUNT,
        "blockWorkers": QROC_BLOCK_WORKERS,
        "deepseekMaxConcurrentCalls": DEEPSEEK_MAX_CONCURRENT_CALLS,
        "skipQa": skip_qa,
        "blockIds": sorted(requested_block_ids),
    }
    if skip_qa:
        job.setdefault("warnings", []).append("Relecture qualite DeepSeek ignoree pour ce job.")
    save_qroc_job(job)
    draft["generatedQuestions"] = existing_questions if requested_block_ids else []
    draft["generationReport"] = {"warnings": existing_warnings, "errors": existing_errors} if requested_block_ids else {"warnings": [], "errors": []}
    draft["status"] = "generating"
    save_qroc_draft(draft)

    if not blocks:
        job["status"] = "done"
        save_state("done")
        draft["status"] = "generated"
        save_qroc_draft(draft)
        return

    max_workers = max(1, min(QROC_BLOCK_WORKERS, total_blocks))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix=f"qroc-{job_id}") as executor:
        future_to_index = {
            executor.submit(process_block, index, block): index
            for index, block in enumerate(blocks)
        }
        for future in concurrent.futures.as_completed(future_to_index):
            index = future_to_index[future]
            try:
                result = future.result()
            except concurrent.futures.CancelledError:
                continue
            except Exception as exc:
                result = {"index": index, "blockId": f"block-{index + 1}", "questions": [], "warnings": [], "errors": [str(exc)], "usage": []}
            block_id = result.get("blockId") or f"block-{index + 1}"
            with state_lock:
                active_blocks.discard(block_id)
                block_states[block_id] = "error" if result.get("errors") else "done"
                results_by_index[result["index"]] = result
                persist_merged_state()
                if job_id in QROC_CANCEL_REQUESTS:
                    for pending in future_to_index:
                        if not pending.done():
                            pending.cancel()

    if job_id in QROC_CANCEL_REQUESTS:
        job["status"] = "cancelled"
        QROC_CANCEL_REQUESTS.discard(job_id)
        save_state("cancelled")
        save_qroc_job(job)
        return

    with state_lock:
        questions, warnings, errors, infos, usage = merge_qroc_block_results(results_by_index)
        draft["generatedQuestions"] = renumber_qroc_generated_questions(existing_questions + questions)
        draft["generationReport"] = {
            "warnings": existing_warnings + warnings,
            "errors": existing_errors + errors,
            "infos": existing_infos + infos,
        }
        draft["status"] = "generated-with-errors" if draft["generationReport"]["errors"] else "generated"
        recompute_generated_series(draft["generatedQuestions"])
        job["usage"] = usage
        job["errors"] = errors
        job["status"] = "done" if not errors else "done-with-errors"
        save_state("done")
        save_qroc_draft(draft)
        save_qroc_job(job)


# fold_ascii, clean_pdf_text import\u00e9s depuis core.text_utils (Phase 1)


# parse_uness_correction_local importé depuis core.parsing (Phase 1)


def write_annale_images(annale):
    """Wrapper local : injecte le images_dir cible depuis annale_images_dir."""
    return _write_annale_images_core(annale, annale_images_dir(annale["id"]))


def lite_image(img):
    """Garde les metadonnees de l'image, retire le dataUrl base64 et marque 'lite'."""
    if not isinstance(img, dict):
        return img
    return {
        "id": img.get("id"),
        "dataUrl": None,
        "dataUrlStatus": img.get("dataUrlStatus"),
        "alt": img.get("alt"),
        "title": img.get("title"),
        "width": img.get("width"),
        "height": img.get("height"),
        "section": img.get("section"),
        # Flag pour le client : image disponible en full via /api/captures/<id>
        "lite": True if img.get("dataUrl") else False,
        # On expose juste si une image existe (pour badges et placeholder)
        "hasData": bool(img.get("dataUrl"))
    }


def lite_version(question):
    """Version 'liste' : metadonnees + images sans dataUrl pour reduire le payload."""
    if not isinstance(question, dict):
        return question
    out = dict(question)
    if isinstance(out.get("images"), list):
        out["images"] = [lite_image(i) for i in out["images"]]
    if isinstance(out.get("screenshots"), list):
        out["screenshots"] = [lite_image(i) for i in out["screenshots"]]
    return out


def list_captures(lite: bool = True) -> list:
    captures = []
    if not os.path.isdir(DATA_DIR):
        return captures
    for name in os.listdir(DATA_DIR):
        if not (name.startswith("q_") and name.endswith(".json")):
            continue
        try:
            with open(os.path.join(DATA_DIR, name), "r", encoding="utf-8") as fh:
                question = json.load(fh)
            captures.append(lite_version(question) if lite else question)
        except Exception as e:
            print(f"[warn] illisible : {name} ({e})", file=sys.stderr)
    return captures


class Handler(BaseHTTPRequestHandler):
    server_version = "HypocampusLocal/1.0"

    def log_message(self, fmt, *args):
        # log court, sans bruit du parent
        sys.stderr.write(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}\n")

    # --- Helpers ---------------------------------------------------------

    def _send_json(self, status: int, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status: int, message: str):
        self._send_json(status, {"error": message})

    def _cors(self):
        # Permissif car le serveur ne bind que sur 127.0.0.1.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def _read_json_body(self, max_bytes=None):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return None
        if max_bytes is not None and length > max_bytes:
            raise ValueError(f"payload trop volumineux ({length} bytes, max {max_bytes})")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON invalide : {e}")

    def _serve_static(self, path: str):
        # path commence par / ; "/"" -> index.html
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(WEB_DIR, rel))
        # protection path traversal
        if not full.startswith(os.path.normpath(WEB_DIR) + os.sep) and full != os.path.normpath(WEB_DIR):
            self._send_error(403, "chemin interdit")
            return
        if not os.path.isfile(full):
            # Fallback SPA : les routes client-side React Router (/q/<id>) renvoient index.html
            fallback = os.path.join(WEB_DIR, "index.html")
            if os.path.isfile(fallback):
                full = fallback
            else:
                self._send_error(404, "fichier introuvable")
                return
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        try:
            with open(full, "rb") as fh:
                data = fh.read()
        except OSError as e:
            self._send_error(500, f"lecture impossible : {e}")
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    # --- HTTP methods ----------------------------------------------------

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path == "/api/health":
            self._send_json(200, {"ok": True, "captures": len(os.listdir(DATA_DIR))})
            return

        # ── Phase 0.3 — Backups ──────────────────────────────────
        if path == "/api/admin/backups":
            handlers.admin.handle_backups_list(self, backup_manager=_backup_manager)
            return

        # ── Diagnostic — Vignettes orphelines (chantier C1) ──────
        if path == "/api/admin/orphan-vignettes":
            handlers.admin.handle_orphan_vignettes(self, _annales_cache)
            return

        # ── Admin : détail raw d'une question (édition F2) ────────
        m_ads = re.match(r"^/api/admin/annales/([A-Za-z0-9_\-]{1,80})/source$", path)
        if m_ads:
            qid = (parse_qs(url.query or "").get("questionId") or [None])[0]
            handlers.annales.handle_admin_annale_source(
                self,
                annales_cache=_annales_cache,
                extracted_dir=EXTRACTED_DIR,
                qroc_drafts_dir=QROC_DRAFTS_DIR,
                aid=m_ads.group(1),
                qid=qid,
            )
            return

        m_ada = re.match(r"^/api/admin/annales/([A-Za-z0-9_\-]{1,80})$", path)
        if m_ada:
            handlers.annales.handle_admin_annale_detail(
                self, annales_cache=_annales_cache, aid=m_ada.group(1),
            )
            return

        m_adq = re.match(
            r"^/api/admin/annales/([A-Za-z0-9_\-]{1,80})/questions/([A-Za-z0-9_\-]{1,80})$",
            path,
        )
        if m_adq:
            handlers.admin.handle_admin_question_detail(
                self, annales_cache=_annales_cache,
                aid=m_adq.group(1), qid=m_adq.group(2),
            )
            return

        # ── Signalements utilisateur (B1) ──────────────────────────
        if path == "/api/reports/summary":
            handlers.reports.handle_reports_summary(
                self, report_store=_report_store,
                annales_cache=_annales_cache,
                orphan_count_fn=handlers.admin.count_orphan_questions,
            )
            return
        if path == "/api/reports":
            qs = parse_qs(url.query or "")
            handlers.reports.handle_report_list(self, report_store=_report_store, query_params=qs)
            return

        if path == "/api/captures":
            handlers.captures.handle_capture_list(self, list_captures_fn=list_captures)
            return

        if path == "/api/dedupe-scan":
            # Regroupe les questions par signature de contenu : retourne les groupes ≥ 2
            groups_by_content = {}
            for name in os.listdir(DATA_DIR):
                if not (name.startswith("q_") and name.endswith(".json")):
                    continue
                try:
                    with open(os.path.join(DATA_DIR, name), "r", encoding="utf-8") as fh:
                        q = json.load(fh)
                    c_sig = compute_content_signature(q)
                    groups_by_content.setdefault(c_sig, []).append({
                        "id": q.get("id"),
                        "questionText": (q.get("questionText") or "")[:200],
                        "subject": q.get("subject"),
                        "capturedAt": q.get("capturedAt"),
                        "url": q.get("url"),
                        "status": q.get("status"),
                    })
                except Exception:
                    continue
            duplicates = [
                {"contentSignature": sig, "questions": qs}
                for sig, qs in groups_by_content.items() if len(qs) >= 2
            ]
            self._send_json(200, {
                "duplicateGroups": duplicates,
                "totalDuplicateGroups": len(duplicates),
                "totalIndexedQuestions": sum(len(g["questions"]) for g in duplicates),
            })
            return

        m = re.match(r"^/api/captures/([A-Za-z0-9_\-]{1,80})$", path)
        if m:
            # GET /api/captures/<qid> — délégué à handlers.captures
            handlers.captures.handle_capture_detail(
                self, capture_path=capture_path, qid=m.group(1),
            )
            return

        # ── ANNALES ──────────────────────────────────────────────
        if path == "/api/annales":
            # GET /api/annales — délégué à handlers.annales
            handlers.annales.handle_annales_list(
                self, annales_cache=_annales_cache, annale_summary=annale_summary,
            )
            return

        if path == "/api/annales/drafts":
            # Liste light des brouillons. Par defaut: actifs; archived=1: publies.
            archived = (parse_qs(url.query).get("archived") or ["0"])[0] == "1"
            summaries = []
            try:
                for name in os.listdir(QROC_DRAFTS_DIR):
                    if not name.endswith(".json"):
                        continue
                    if name.startswith("_"):
                        continue
                    draft_id = name[:-5]
                    if not SAFE_ID.match(draft_id):
                        continue
                    draft = load_qroc_draft(draft_id)
                    if not draft:
                        continue
                    publish_log = draft.get("publishLog") if isinstance(draft.get("publishLog"), dict) else None
                    published_at = draft.get("publishedAt") or (publish_log or {}).get("publishedAt")
                    is_published = draft.get("status") == "published" or bool(published_at) or bool(publish_log)
                    if is_published != archived:
                        continue
                    meta = draft.get("meta") or {}
                    summaries.append({
                        "id": draft.get("id") or draft_id,
                        "annaleId": meta.get("annaleId"),
                        "title": meta.get("title") or draft_id,
                        "subject": meta.get("subject"),
                        "year": meta.get("year"),
                        "session": meta.get("session"),
                        "profile": draft.get("profile") or "qroc",
                        "status": "published" if is_published else draft.get("status"),
                        "createdAt": draft.get("createdAt"),
                        "updatedAt": draft.get("updatedAt"),
                        "publishedAt": published_at,
                        "publishLog": publish_log,
                        "sourceBlocks": len(draft.get("sourceBlocks") or []),
                        "generatedQuestions": len(draft.get("generatedQuestions") or []),
                    })
            except FileNotFoundError:
                pass
            summaries.sort(key=lambda s: s.get("updatedAt") or s.get("createdAt") or "", reverse=True)
            self._send_json(200, summaries)
            return

        m = re.match(r"^/api/annales/drafts/([A-Za-z0-9_\-]{1,80})$", path)
        if m:
            # GET /api/annales/drafts/<id> — délégué à handlers.qroc
            handlers.qroc.handle_draft_detail(
                self, load_qroc_draft=load_qroc_draft, draft_id=m.group(1),
            )
            return

        m = re.match(r"^/api/annales/drafts/([A-Za-z0-9_\-]{1,80})/img/([A-Za-z0-9_\-.]{1,200})$", path)
        if m:
            draft_id, filename = m.group(1), safe_filename(m.group(2))
            if not filename:
                self._send_error(400, "nom image invalide")
                return
            image_path = os.path.join(qroc_draft_images_dir(draft_id), filename)
            if not os.path.isfile(image_path):
                self._send_error(404, "image inconnue")
                return
            with open(image_path, "rb") as fh:
                data = fh.read()
            ext = os.path.splitext(filename)[1].lower()
            self.send_response(200)
            self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return

        m = re.match(r"^/api/annales/convert-qroc/jobs/([A-Za-z0-9_\-]{1,80})$", path)
        if m:
            # GET /api/annales/convert-qroc/jobs/<id> — délégué à handlers.qroc
            handlers.qroc.handle_job_status(
                self, load_qroc_job=load_qroc_job, job_id=m.group(1),
            )
            return

        m = re.match(r"^/api/annales/([A-Za-z0-9_\-]{1,80})$", path)
        if m:
            aid = m.group(1)
            annale = _annales_cache.get(aid)
            if not annale:
                self._send_error(404, "annale inconnue")
                return
            # Mode play : strip les bonnes réponses
            self._send_json(200, annale_for_play(annale))
            return

        m = re.match(r"^/api/annales/([A-Za-z0-9_\-]{1,80})/img/([A-Za-z0-9_\-.]{1,200})$", path)
        if m:
            serve_annale_image(self, m.group(1), m.group(2))
            return

        # ── EXAM SESSIONS (historique) — délégué à handlers.exam_sessions
        if path == "/api/exam-sessions":
            handlers.exam_sessions.handle_session_list(self, list_sessions_fn=list_exam_sessions)
            return

        m = re.match(r"^/api/exam-sessions/([A-Za-z0-9_\-]{1,80})$", path)
        if m:
            handlers.exam_sessions.handle_session_detail(
                self,
                session_path=exam_session_path,
                session_id=m.group(1),
                transform_session_fn=_with_recalculated_session_score,
            )
            return

        # Sinon : statique
        self._serve_static(path)

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path

        m_admin_validate = re.match(r"^/api/admin/annales/([A-Za-z0-9_\-]{1,80})/validate$", path)
        if m_admin_validate:
            handlers.annales.handle_admin_annale_validate(
                self, annales_cache=_annales_cache, aid=m_admin_validate.group(1),
            )
            return

        m_admin_create_q = re.match(r"^/api/admin/annales/([A-Za-z0-9_\-]{1,80})/questions$", path)
        if m_admin_create_q:
            try:
                payload = self._read_json_body(max_bytes=1 * 1024 * 1024)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            handlers.annales.handle_admin_question_create(
                self,
                annales_cache=_annales_cache,
                annale_path=annale_path,
                backup_manager=_backup_manager,
                write_json_file_fn=write_json_file,
                audit_log_fn=audit_log,
                aid=m_admin_create_q.group(1),
                payload=payload,
            )
            return

        m_admin_reorder = re.match(r"^/api/admin/annales/([A-Za-z0-9_\-]{1,80})/questions/reorder$", path)
        if m_admin_reorder:
            try:
                payload = self._read_json_body(max_bytes=1 * 1024 * 1024)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            handlers.annales.handle_admin_questions_reorder(
                self,
                annales_cache=_annales_cache,
                annale_path=annale_path,
                backup_manager=_backup_manager,
                write_json_file_fn=write_json_file,
                audit_log_fn=audit_log,
                aid=m_admin_reorder.group(1),
                payload=payload,
            )
            return

        m_admin_img = re.match(
            r"^/api/admin/annales/([A-Za-z0-9_\-]{1,80})/questions/([A-Za-z0-9_\-]{1,80})/images$",
            path,
        )
        if m_admin_img:
            try:
                payload = self._read_json_body(max_bytes=30 * 1024 * 1024)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            handlers.annales.handle_admin_question_image_upload(
                self,
                annales_cache=_annales_cache,
                annale_path=annale_path,
                annale_images_dir=annale_images_dir,
                backup_manager=_backup_manager,
                write_json_file_fn=write_json_file,
                audit_log_fn=audit_log,
                aid=m_admin_img.group(1),
                qid=m_admin_img.group(2),
                payload=payload,
            )
            return

        # ── Phase 0.3 — Backup à la demande ──────────────────────
        if path == "/api/admin/backup":
            handlers.admin.handle_backup_create(self, backup_manager=_backup_manager, audit_log=audit_log)
            return

        # ── Signalements utilisateur (B1) ──────────────────────────
        if path == "/api/reports":
            try:
                payload = self._read_json_body(max_bytes=64 * 1024)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            handlers.reports.handle_report_create(
                self, report_store=_report_store, audit_log=audit_log, payload=payload,
            )
            return

        if path == "/api/annales/convert-qroc/extract":
            try:
                payload = self._read_json_body(max_bytes=MAX_IMPORT_PAYLOAD_BYTES)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            if not isinstance(payload, dict):
                self._send_error(400, "payload doit etre un objet JSON")
                return
            annale_id = safe_slug(payload.get("annaleId"), fallback="annale")
            if not SAFE_ID.match(annale_id):
                self._send_error(400, "annaleId invalide")
                return
            subject = str(payload.get("subject") or "").strip()
            title = str(payload.get("title") or "").strip()[:200]
            session = str(payload.get("session") or "").strip()[:80]
            try:
                year = int(payload.get("year"))
            except (TypeError, ValueError):
                self._send_error(400, "annee invalide")
                return
            if not subject or not title:
                self._send_error(400, "matiere ou titre manquant")
                return
            pdf_b64 = payload.get("pdfBase64")
            if not isinstance(pdf_b64, str) or not pdf_b64:
                self._send_error(400, "pdfBase64 manquant")
                return
            if "," in pdf_b64:
                pdf_b64 = pdf_b64.split(",", 1)[1]
            try:
                pdf_bytes = base64.b64decode(pdf_b64, validate=True)
            except Exception as e:
                self._send_error(400, f"pdfBase64 invalide : {e}")
                return
            draft_id = generate_qroc_id("draft")
            profile = "faithful" if str(payload.get("profile") or "").strip().lower() == "faithful" else "qroc"
            meta = {"id": annale_id, "title": title, "subject": subject, "year": year, "session": session}
            try:
                draft, raw_text = parse_qroc_source_pdf(pdf_bytes, meta, draft_id, payload.get("filename"), profile=profile)
                save_qroc_draft(draft)
                with open(os.path.join(EXTRACTED_DIR, f"{annale_id}.qroc-source.txt"), "w", encoding="utf-8") as fh:
                    fh.write(raw_text)
            except RuntimeError as e:
                self._send_error(400, str(e))
                return
            except OSError as e:
                self._send_error(500, f"ecriture brouillon echouee : {e}")
                return
            self._send_json(200, {"draftId": draft_id, "draft": draft})
            return

        m = re.match(r"^/api/annales/convert-qroc/drafts/([A-Za-z0-9_\-]{1,80})/generate$", path)
        if m:
            draft_id = m.group(1)
            draft = load_qroc_draft(draft_id)
            if not draft:
                self._send_error(404, "brouillon inconnu")
                return
            try:
                payload = self._read_json_body(max_bytes=1024 * 1024)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            if not isinstance(payload, dict):
                self._send_error(400, "payload doit etre un objet JSON")
                return
            mock = bool(payload.get("mock"))
            skip_qa = bool(payload.get("skipQa"))
            block_ids = payload.get("blockIds") if isinstance(payload.get("blockIds"), list) else None
            api_key = str(payload.get("apiKey") or "").strip()
            model = str(payload.get("model") or "deepseek-v4-flash").strip()
            if model not in DEEPSEEK_MODELS:
                self._send_error(400, f"modele DeepSeek invalide : {model}")
                return
            if not mock and not api_key:
                self._send_error(400, "apiKey manquante")
                return
            job = enqueue_qroc_generation(draft_id, api_key, model, mock=mock, skip_qa=skip_qa, block_ids=block_ids)
            self._send_json(202, {"jobId": job["id"], "draftId": draft_id, "status": job["status"], "workerConfig": job.get("workerConfig")})
            return

        m = re.match(r"^/api/annales/convert-qroc/jobs/([A-Za-z0-9_\-]{1,80})/cancel$", path)
        if m:
            # POST /api/annales/convert-qroc/jobs/<id>/cancel — délégué à handlers.qroc
            handlers.qroc.handle_job_cancel(
                self,
                load_qroc_job=load_qroc_job,
                save_qroc_job=save_qroc_job,
                cancel_requests_set=QROC_CANCEL_REQUESTS,
                job_id=m.group(1),
            )
            return

        m = re.match(r"^/api/annales/drafts/([A-Za-z0-9_\-]{1,80})/publish$", path)
        if m:
            draft = load_qroc_draft(m.group(1))
            if not draft:
                self._send_error(404, "brouillon inconnu")
                return
            try:
                payload = self._read_json_body(max_bytes=1024 * 1024) or {}
            except ValueError as e:
                self._send_error(400, str(e))
                return
            overwrite = bool(payload.get("overwrite")) if isinstance(payload, dict) else False
            meta = draft.get("meta") or {}
            original_annale_id = meta.get("annaleId")
            if not original_annale_id or not SAFE_ID.match(original_annale_id):
                self._send_error(400, "annaleId invalide dans le brouillon")
                return
            blocking_errors = (draft.get("generationReport") or {}).get("errors") or []
            if blocking_errors and not bool(payload.get("force")):
                self._send_error(400, "publication bloquee : erreurs de generation a corriger ou force=true")
                return

            # Determination de l'annaleId final :
            # - Si overwrite=true → utiliser l'ID original (ecrasement)
            # - Si overwrite=false ET l'ID est libre → utiliser l'original
            # - Si overwrite=false ET l'ID est pris → auto-rename en <id>-2, <id>-3, ..., <id>-20
            annale_id = original_annale_id
            auto_renamed = False
            if not overwrite and os.path.exists(annale_path(original_annale_id)):
                # Cherche le premier suffixe libre
                MAX_RENAME_ATTEMPTS = 20
                found = False
                for n in range(2, MAX_RENAME_ATTEMPTS + 2):
                    candidate = f"{original_annale_id}-{n}"[:80]
                    if not SAFE_ID.match(candidate):
                        continue
                    if not os.path.exists(annale_path(candidate)):
                        annale_id = candidate
                        auto_renamed = True
                        found = True
                        break
                if not found:
                    self._send_error(409, f"impossible de trouver un identifiant libre apres {MAX_RENAME_ATTEMPTS} tentatives pour {original_annale_id}")
                    return

            try:
                # Si auto-rename, on met a jour meta.annaleId dans le draft AVANT de publier
                # pour que draft_to_publish_annale utilise le nouvel ID dans le JSON publie
                if auto_renamed:
                    meta["annaleId"] = annale_id
                    draft["meta"] = meta
                annale, warnings = draft_to_publish_annale(draft)
                target_path = annale_path(annale_id)
                with QROC_FILE_LOCK:
                    # Double-check anti-race condition
                    if os.path.exists(target_path) and not overwrite and not auto_renamed:
                        self._send_error(409, f"annale deja existante : {annale_id}")
                        return
                    tmp_path = f"{target_path}.tmp"
                    with open(tmp_path, "w", encoding="utf-8") as fh:
                        json.dump(annale, fh, ensure_ascii=False, indent=2)
                    os.replace(tmp_path, target_path)
                draft["status"] = "published"
                draft["publishedAt"] = utc_now_iso()
                draft["publishWarnings"] = warnings
                draft["publishLog"] = {
                    "draftId": draft.get("id"),
                    "annaleId": annale_id,
                    "originalAnnaleId": original_annale_id if auto_renamed else None,
                    "autoRenamed": auto_renamed,
                    "questions": len(annale.get("questions") or []),
                    "publishedAt": draft["publishedAt"],
                }
                save_qroc_draft(draft)
                load_annales()
            except (ValueError, OSError, KeyError) as e:
                self._send_error(400, str(e))
                return
            # Audit log (Phase 0.4)
            audit_log("publish_annale", {
                "annaleId": annale_id,
                "originalAnnaleId": original_annale_id if auto_renamed else None,
                "autoRenamed": auto_renamed,
                "draftId": draft.get("id"),
                "questionsCount": len(annale.get("questions") or []),
            })
            response = {
                "published": True,
                "annale": annale_summary(annale),
                "redirectTo": f"/entrainement/{annale_id}",
                "warnings": warnings,
                "autoRenamed": auto_renamed,
            }
            if auto_renamed:
                response["originalAnnaleId"] = original_annale_id
            self._send_json(200, response)
            return

        if path == "/api/annales/import/local":
            try:
                payload = self._read_json_body(max_bytes=MAX_IMPORT_PAYLOAD_BYTES)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            # Validation systématique via core.models (Phase 1 — modèles dataclass)
            try:
                meta_validated = LocalImportMeta.from_dict(payload)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            annale_id = safe_slug(meta_validated.annaleId, fallback="annale")
            if not SAFE_ID.match(annale_id):
                self._send_error(400, "annaleId invalide")
                return
            subject = meta_validated.subject
            year = meta_validated.year
            session = meta_validated.session
            title = meta_validated.title
            overwrite = meta_validated.overwrite
            original_annale_id = annale_id
            auto_renamed = False
            if not overwrite and os.path.exists(annale_path(annale_id)):
                # Auto-rename : essaie <id>-2, <id>-3, ..., <id>-20
                MAX_RENAME_ATTEMPTS = 20
                found = False
                for n in range(2, MAX_RENAME_ATTEMPTS + 2):
                    candidate = f"{annale_id}-{n}"[:80]
                    if not SAFE_ID.match(candidate):
                        continue
                    if not os.path.exists(annale_path(candidate)):
                        annale_id = candidate
                        auto_renamed = True
                        found = True
                        break
                if not found:
                    self._send_error(409, f"impossible de trouver un identifiant libre apres {MAX_RENAME_ATTEMPTS} tentatives pour {original_annale_id}")
                    return
            target_path = annale_path(annale_id)

            pdf_b64 = payload.get("pdfBase64")
            if not isinstance(pdf_b64, str) or not pdf_b64:
                self._send_error(400, "pdfBase64 manquant")
                return
            if "," in pdf_b64:
                pdf_b64 = pdf_b64.split(",", 1)[1]
            try:
                pdf_bytes = base64.b64decode(pdf_b64, validate=True)
            except Exception as e:
                self._send_error(400, f"pdfBase64 invalide : {e}")
                return
            if len(pdf_bytes) < 1000:
                self._send_error(400, "PDF trop petit ou vide")
                return

            meta = {
                "id": annale_id,  # peut etre auto-renomme si collision
                "title": title,
                "subject": subject,
                "year": year,
                "session": session,
            }
            try:
                annale, report, raw_text = parse_uness_correction_local(pdf_bytes, meta)
            except RuntimeError as e:
                self._send_error(400, str(e))
                return

            try:
                os.makedirs(EXTRACTED_DIR, exist_ok=True)
                with open(os.path.join(EXTRACTED_DIR, f"{annale_id}.local.txt"), "w", encoding="utf-8") as fh:
                    fh.write(raw_text)
                images_written = write_annale_images(annale)
                report["imagesWritten"] = images_written
                with open(os.path.join(EXTRACTED_DIR, f"{annale_id}.local-report.json"), "w", encoding="utf-8") as fh:
                    json.dump(report, fh, ensure_ascii=False, indent=2)
                # Écriture atomique de l'annale finale (Phase 0.2)
                write_json_file(target_path, annale)
            except OSError as e:
                self._send_error(500, f"ecriture import local echouee : {e}")
                return

            load_annales()
            # Audit log (Phase 0.4)
            audit_log("import_local_annale", {
                "annaleId": annale_id,
                "originalAnnaleId": original_annale_id if auto_renamed else None,
                "autoRenamed": auto_renamed,
                "questionsCount": len(annale.get("questions") or []),
                "pages": report.get("pages"),
            })
            response = {
                "imported": True,
                "annale": annale_summary(annale),
                "path": os.path.relpath(target_path, ROOT),
                "redirectTo": f"/entrainement/{annale_id}",
                "mode": "local",
                "pages": report.get("pages"),
                "textChars": report.get("textChars"),
                "report": report,
                "warnings": report.get("warnings") or [],
                "autoRenamed": auto_renamed,
            }
            if auto_renamed:
                response["originalAnnaleId"] = original_annale_id
            self._send_json(200, response)
            return

        if path == "/api/annales/import/deepseek":
            self._send_error(
                410,
                "import DeepSeek complet desactive : l'import principal est local. "
                "DeepSeek ne doit etre utilise que plus tard sur des blocs deja decoupes.",
            )
            return

        # ── ANNALES — Grade global ──────────────────────────────
        m = re.match(r"^/api/annales/([A-Za-z0-9_\-]{1,80})/grade$", path)
        if m:
            aid = m.group(1)
            annale = _annales_cache.get(aid)
            if not annale:
                self._send_error(404, "annale inconnue")
                return
            try:
                payload = self._read_json_body()
            except ValueError as e:
                self._send_error(400, str(e))
                return
            # Validation systématique via core.models (Phase 1)
            try:
                validated = GradeAllPayload.from_dict(payload)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            result = grade_annale(annale, validated.answers)
            self._send_json(200, result)
            return

        # ── ANNALES — Grade UNE question (mode libre) ──────────
        m = re.match(r"^/api/annales/([A-Za-z0-9_\-]{1,80})/grade-one$", path)
        if m:
            aid = m.group(1)
            annale = _annales_cache.get(aid)
            if not annale:
                self._send_error(404, "annale inconnue")
                return
            try:
                payload = self._read_json_body()
            except ValueError as e:
                self._send_error(400, str(e))
                return
            # Validation systématique via core.models (Phase 1)
            try:
                validated = GradeOnePayload.from_dict(payload)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            detail = grade_one_question(annale, validated.qid, validated.answer)
            if detail is None:
                self._send_error(404, "question inconnue dans cette annale")
                return
            self._send_json(200, detail)
            return

        # ── ANNALES — Regroupement rétroactif QI → série DP (chantier C2)
        m = re.match(r"^/api/annales/([A-Za-z0-9_\-]{1,80})/regroup-to-dp$", path)
        if m:
            aid = m.group(1)
            try:
                payload = self._read_json_body()
            except ValueError as e:
                self._send_error(400, str(e))
                return
            handlers.annales.handle_annale_regroup_to_dp(
                self,
                annales_cache=_annales_cache,
                annale_path=annale_path,
                write_json_file_fn=write_json_file,
                audit_log_fn=audit_log,
                aid=aid,
                payload=payload,
            )
            return

        # ── EXAM SESSIONS — Création ────────────────────────────
        if path == "/api/exam-sessions":
            try:
                payload = self._read_json_body(max_bytes=20 * 1024 * 1024)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            if not isinstance(payload, dict):
                self._send_error(400, "payload doit etre un objet JSON")
                return

            # Validation systématique via core.models (Phase 1 — modèles dataclass)
            try:
                validated = ExamSessionPayload.from_dict(payload)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            if not SAFE_ID.match(validated.annaleId):
                self._send_error(400, "annaleId invalide")
                return
            annale = _annales_cache.get(validated.annaleId)
            if not annale:
                self._send_error(404, "annale inconnue")
                return
            grading = grade_annale(annale, validated.answers)

            session_id = generate_session_id()
            session = {
                "id": session_id,
                "annaleId": validated.annaleId,
                "annaleTitle": annale.get("title"),
                "annaleSubject": annale.get("subject"),
                "annaleYear": annale.get("year"),
                "annaleSession": annale.get("session"),
                "mode": validated.mode,
                "startedAt": validated.startedAt,
                "submittedAt": validated.submittedAt or datetime.now(timezone.utc).isoformat(),
                "durationSec": validated.durationSec,
                "answers": validated.answers,
                "finalScore": grading.get("finalScore"),
                "details": grading.get("details"),
            }
            # Écriture atomique (Phase 0.2) : write_json_file fait .tmp + os.replace()
            try:
                write_json_file(exam_session_path(session_id), session)
            except OSError as e:
                self._send_error(500, f"ecriture session echouee : {e}")
                return
            self._send_json(200, {"saved": True, "id": session_id})
            return

        if path == "/api/captures":
            try:
                payload = self._read_json_body()
            except ValueError as e:
                self._send_error(400, str(e))
                return
            if not isinstance(payload, dict):
                self._send_error(400, "payload doit etre un objet JSON")
                return
            qid = payload.get("id")
            if not isinstance(qid, str) or not SAFE_ID.match(qid):
                self._send_error(400, "id manquant ou invalide")
                return
            file = capture_path(qid)

            # ── Anti-doublon & détection de revue ────────────────────
            session_sig = compute_session_signature(payload)
            content_sig = compute_content_signature(payload)

            # 1) Session signature déjà connue → c'est exactement la même capture
            existing_by_session = lookup_session_index(session_sig)
            if existing_by_session and existing_by_session != qid:
                self._send_json(200, {
                    "saved": False,
                    "reason": "Capture déjà existante (session identique).",
                    "duplicateOf": existing_by_session,
                })
                return

            # 2) Content signature connue mais session différente → revue !
            existing_by_content = lookup_content_index(content_sig)
            if existing_by_content and existing_by_content != qid:
                target_file = capture_path(existing_by_content)
                if os.path.isfile(target_file):
                    try:
                        with open(target_file, "r", encoding="utf-8") as fh:
                            target = json.load(fh)
                    except (OSError, json.JSONDecodeError) as e:
                        self._send_error(500, f"lecture cible echouee : {e}")
                        return

                    revue_entry = {
                        "at": datetime.now(timezone.utc).isoformat(),
                        "url": payload.get("url"),
                        "status": payload.get("status"),
                        "selectedAnswers": payload.get("selectedAnswers") or [],
                        "seriesId": payload.get("seriesId"),
                        "seriesPosition": payload.get("seriesPosition"),
                    }
                    seen_again = target.get("seenAgain") if isinstance(target.get("seenAgain"), list) else []
                    seen_again.append(revue_entry)
                    target["seenAgain"] = seen_again

                    # Écriture atomique via write_json_file (Phase 0.2)
                    try:
                        write_json_file(target_file, target)
                    except OSError as e:
                        self._send_error(500, f"ecriture cible echouee : {e}")
                        return

                    # Indexer aussi cette nouvelle session_sig sur l'id existant
                    set_session_index(session_sig, existing_by_content)

                    self._send_json(200, {
                        "saved": False,
                        "reason": "Revue enregistrée sur question existante.",
                        "duplicateOf": existing_by_content,
                        "seenAgainCount": len(seen_again),
                    })
                    return

            # 3) Vraiment nouveau → écriture atomique (Phase 0.2) + indexation
            try:
                write_json_file(file, payload)
            except OSError as e:
                self._send_error(500, f"ecriture echouee : {e}")
                return

            register_question_in_indexes(payload)
            self._send_json(200, {"saved": True, "id": qid, "path": os.path.relpath(file, ROOT)})
            return

        # POST /api/captures/<id>/screenshots : ajoute une image manuelle a une question
        m = re.match(r"^/api/captures/([A-Za-z0-9_\-]{1,80})/screenshots$", path)
        if m:
            qid = m.group(1)
            file = capture_path(qid)
            if not os.path.isfile(file):
                self._send_error(404, "capture inconnue")
                return
            try:
                payload = self._read_json_body()
            except ValueError as e:
                self._send_error(400, str(e))
                return
            if not isinstance(payload, dict):
                self._send_error(400, "payload doit etre un objet JSON")
                return
            data_url = payload.get("dataUrl")
            if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
                self._send_error(400, "dataUrl manquant ou invalide (doit commencer par 'data:image/')")
                return
            try:
                with open(file, "r", encoding="utf-8") as fh:
                    question = json.load(fh)
            except (OSError, json.JSONDecodeError) as e:
                self._send_error(500, f"lecture impossible : {e}")
                return
            screenshots = question.get("screenshots") if isinstance(question.get("screenshots"), list) else []
            images = question.get("images") if isinstance(question.get("images"), list) else []
            sid = f"manual_{len(screenshots) + 1}"
            entry = {
                "id": sid,
                "dataUrl": data_url,
                "dataUrlStatus": "manual",
                "alt": str(payload.get("alt") or "Image ajoutee manuellement")[:500],
                "title": str(payload.get("title") or "")[:500],
                "width": payload.get("width") if isinstance(payload.get("width"), (int, float)) else None,
                "height": payload.get("height") if isinstance(payload.get("height"), (int, float)) else None,
                "section": "screenshot",
                "addedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z"
            }
            question["screenshots"] = screenshots + [entry]
            question["images"] = images + [entry]
            # Écriture atomique (Phase 0.2)
            try:
                write_json_file(file, question)
            except OSError as e:
                self._send_error(500, f"ecriture echouee : {e}")
                return
            self._send_json(200, {"added": True, "id": qid, "screenshotId": sid, "screenshotCount": len(question["screenshots"])})
            return

        self._send_error(404, "endpoint inconnu")

    def do_PUT(self):
        url = urlparse(self.path)
        path = url.path

        m_admin_replace = re.match(
            r"^/api/admin/annales/([A-Za-z0-9_\-]{1,80})/questions/([A-Za-z0-9_\-]{1,80})$",
            path,
        )
        if m_admin_replace:
            try:
                payload = self._read_json_body(max_bytes=1 * 1024 * 1024)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            qs = parse_qs(url.query or "")
            dry_run_flag = "1" in (qs.get("dryRun") or [])
            handlers.annales.handle_admin_question_replace(
                self,
                annales_cache=_annales_cache,
                annale_path=annale_path,
                sessions_dir=EXAM_SESSIONS_DIR,
                backup_manager=_backup_manager,
                write_json_file_fn=write_json_file,
                audit_log_fn=audit_log,
                aid=m_admin_replace.group(1),
                qid=m_admin_replace.group(2),
                payload=payload,
                dry_run=dry_run_flag,
            )
            return

        self._send_error(404, "endpoint inconnu")

    def do_PATCH(self):
        url = urlparse(self.path)
        path = url.path

        # ── Signalements utilisateur (B1) ──────────────────────────
        m_rep = re.match(r"^/api/reports/(rep_[A-Za-z0-9]{1,32})$", path)
        if m_rep:
            try:
                payload = self._read_json_body(max_bytes=4 * 1024)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            handlers.reports.handle_report_resolve(
                self,
                report_store=_report_store,
                audit_log=audit_log,
                report_id=m_rep.group(1),
                payload=payload,
            )
            return

        # ── PATCH d'une question publiée (B2) ──────────────────────
        m_qpatch = re.match(
            r"^/api/annales/([A-Za-z0-9_\-]{1,80})/questions/([A-Za-z0-9_\-]{1,80})$",
            path,
        )
        if m_qpatch:
            aid_q = m_qpatch.group(1)
            qid_q = m_qpatch.group(2)
            try:
                payload = self._read_json_body(max_bytes=1 * 1024 * 1024)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            from urllib.parse import parse_qs
            qs = parse_qs(url.query or "")
            dry_run_flag = "1" in (qs.get("dryRun") or [])
            handlers.annales.handle_annale_patch_question(
                self,
                annales_cache=_annales_cache,
                annale_path=annale_path,
                sessions_dir=EXAM_SESSIONS_DIR,
                backup_manager=_backup_manager,
                write_json_file_fn=write_json_file,
                audit_log_fn=audit_log,
                aid=aid_q,
                qid=qid_q,
                payload=payload,
                dry_run=dry_run_flag,
                backup_done_ref=_patch_backup_done,
            )
            return

        m = re.match(r"^/api/annales/convert-qroc/drafts/([A-Za-z0-9_\-]{1,80})/source-blocks$", path)
        if m:
            draft = load_qroc_draft(m.group(1))
            if not draft:
                self._send_error(404, "brouillon inconnu")
                return
            try:
                payload = self._read_json_body(max_bytes=20 * 1024 * 1024)
                source_blocks = normalize_source_blocks_for_patch(payload.get("sourceBlocks") if isinstance(payload, dict) else None)
            except (ValueError, AttributeError) as e:
                self._send_error(400, str(e))
                return
            draft["sourceBlocks"] = source_blocks
            draft["status"] = "source-ready"
            draft["generatedQuestions"] = []
            draft["generationReport"] = {"warnings": [], "errors": []}
            draft["report"]["sourceBlocksDetected"] = len(source_blocks)
            draft["report"]["blockingWarnings"] = sum(
                1 for block in source_blocks for warning in block.get("warnings") or [] if warning.get("blocking")
            )
            save_qroc_draft(draft)
            self._send_json(200, draft)
            return

        m = re.match(r"^/api/annales/drafts/([A-Za-z0-9_\-]{1,80})$", path)
        if m:
            draft = load_qroc_draft(m.group(1))
            if not draft:
                self._send_error(404, "brouillon inconnu")
                return
            try:
                payload = self._read_json_body(max_bytes=30 * 1024 * 1024)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            if not isinstance(payload, dict):
                self._send_error(400, "payload doit etre un objet JSON")
                return
            if isinstance(payload.get("generatedQuestions"), list):
                questions, warnings, errors, infos = normalize_qroc_generated_questions(
                    payload["generatedQuestions"],
                    {"id": "manual", "cleanText": "\n".join(block.get("cleanText") or "" for block in draft.get("sourceBlocks") or [])},
                    0,
                )
                draft["generatedQuestions"] = questions
                draft["generationReport"] = {"warnings": warnings, "errors": errors, "infos": infos}
                draft["status"] = "generated-with-errors" if errors else "generated"
            if isinstance(payload.get("meta"), dict):
                meta = draft.get("meta") or {}
                for key in ("annaleId", "title", "subject", "session"):
                    if key in payload["meta"]:
                        meta[key] = str(payload["meta"][key] or "").strip()
                if "year" in payload["meta"]:
                    meta["year"] = int_or_none(payload["meta"]["year"]) or meta.get("year")
                meta["annaleId"] = safe_slug(meta.get("annaleId"), fallback=draft["id"])
                draft["meta"] = meta
            recompute_generated_series(draft.get("generatedQuestions") or [])
            save_qroc_draft(draft)
            self._send_json(200, draft)
            return

        # ── PATCH annale publiée : renommer title / subject / year / session ──
        m_ann = re.match(r"^/api/annales/([A-Za-z0-9_\-]{1,80})$", url.path)
        if m_ann:
            aid = m_ann.group(1)
            annale = _annales_cache.get(aid)
            file_path = annale_path(aid)
            if not annale or not os.path.isfile(file_path):
                self._send_error(404, "annale inconnue")
                return
            try:
                payload = self._read_json_body()
            except ValueError as e:
                self._send_error(400, str(e))
                return
            if not isinstance(payload, dict):
                self._send_error(400, "payload doit etre un objet JSON")
                return
            # Pré-validation types via core.models (Phase 1)
            # Lève ValueError clair sur year non-int, title vide, etc.
            try:
                _ = AnnalePatchPayload.from_dict(payload)
            except ValueError as e:
                self._send_error(400, str(e))
                return
            updates = {}
            if "title" in payload:
                v = str(payload["title"] or "").strip()[:200]
                if not v:
                    self._send_error(400, "title ne peut pas etre vide")
                    return
                updates["title"] = v
            if "subject" in payload:
                v = str(payload["subject"] or "").strip()[:80]
                if v:
                    updates["subject"] = v
            if "session" in payload:
                v = str(payload["session"] or "").strip()[:20]
                updates["session"] = v or None
            if "year" in payload:
                if payload["year"] is None or payload["year"] == "":
                    updates["year"] = None
                else:
                    try:
                        updates["year"] = int(payload["year"])
                    except (TypeError, ValueError):
                        self._send_error(400, "year doit etre un entier")
                        return
            has_id_change = "newId" in payload and str(payload.get("newId") or "").strip()
            if not updates and not has_id_change:
                self._send_error(400, "aucun champ editable fourni (title, subject, year, session, newId)")
                return
            try:
                with open(file_path, "r", encoding="utf-8") as fh:
                    full = json.load(fh)
            except (OSError, json.JSONDecodeError) as e:
                self._send_error(500, f"lecture impossible : {e}")
                return
            for key, value in updates.items():
                if value is None:
                    full.pop(key, None)
                else:
                    full[key] = value
            if updates:
                try:
                    tmp = f"{file_path}.tmp"
                    with open(tmp, "w", encoding="utf-8") as fh:
                        json.dump(full, fh, ensure_ascii=False, indent=2)
                    os.replace(tmp, file_path)
                except OSError as e:
                    self._send_error(500, f"ecriture echouee : {e}")
                    return
            _annales_cache[aid] = full

            # ── Gestion du rename de l'ID (newId) ──────────────────────────
            renamed = False
            new_id = None
            if "newId" in payload:
                raw_new_id = str(payload.get("newId") or "").strip()
                if not raw_new_id:
                    self._send_error(400, "newId vide")
                    return
                candidate = safe_slug(raw_new_id, fallback="")
                if not candidate or not SAFE_ID.match(candidate):
                    self._send_error(400, "newId invalide (caracteres autorises : a-z 0-9 - _)")
                    return
                if candidate == aid:
                    # No-op : meme ID, pas de rename
                    pass
                else:
                    target_path = annale_path(candidate)
                    if os.path.exists(target_path) or candidate in _annales_cache:
                        self._send_error(409, f"identifiant deja pris : {candidate}")
                        return
                    # Rename atomique : fichier JSON + dossier images + sessions historique + publishLog drafts
                    try:
                        with QROC_FILE_LOCK:
                            # 1. Renomme le fichier .json
                            os.replace(file_path, target_path)
                            # 2. Met a jour le champ 'id' dans le JSON renomme
                            with open(target_path, "r", encoding="utf-8") as fh:
                                renamed_data = json.load(fh)
                            renamed_data["id"] = candidate
                            tmp = f"{target_path}.tmp"
                            with open(tmp, "w", encoding="utf-8") as fh:
                                json.dump(renamed_data, fh, ensure_ascii=False, indent=2)
                            os.replace(tmp, target_path)
                            # 3. Renomme le dossier d'images si present
                            old_images = annale_images_dir(aid)
                            new_images = annale_images_dir(candidate)
                            if os.path.isdir(old_images):
                                os.replace(old_images, new_images)
                            # 4. Met a jour le cache
                            _annales_cache.pop(aid, None)
                            _annales_cache[candidate] = renamed_data
                            # 5. Met a jour les sessions historique qui referencent l'ancien id
                            try:
                                for sname in os.listdir(EXAM_SESSIONS_DIR):
                                    if not sname.endswith(".json"):
                                        continue
                                    spath = os.path.join(EXAM_SESSIONS_DIR, sname)
                                    try:
                                        with open(spath, "r", encoding="utf-8") as sfh:
                                            sdata = json.load(sfh)
                                    except (OSError, json.JSONDecodeError):
                                        continue
                                    if sdata.get("annaleId") == aid:
                                        sdata["annaleId"] = candidate
                                        try:
                                            stmp = f"{spath}.tmp"
                                            with open(stmp, "w", encoding="utf-8") as sfh:
                                                json.dump(sdata, sfh, ensure_ascii=False, indent=2)
                                            os.replace(stmp, spath)
                                        except OSError:
                                            pass
                            except FileNotFoundError:
                                pass
                            # 6. Met a jour publishLog dans les drafts QROC qui pointent vers cet ID
                            try:
                                for dname in os.listdir(QROC_DRAFTS_DIR):
                                    if not dname.endswith(".json") or dname.startswith("_"):
                                        continue
                                    dpath = os.path.join(QROC_DRAFTS_DIR, dname)
                                    try:
                                        with open(dpath, "r", encoding="utf-8") as dfh:
                                            ddata = json.load(dfh)
                                    except (OSError, json.JSONDecodeError):
                                        continue
                                    plog = ddata.get("publishLog") or {}
                                    if plog.get("annaleId") == aid:
                                        plog["annaleId"] = candidate
                                        ddata["publishLog"] = plog
                                        dmeta = ddata.get("meta") or {}
                                        if dmeta.get("annaleId") == aid:
                                            dmeta["annaleId"] = candidate
                                            ddata["meta"] = dmeta
                                        try:
                                            dtmp = f"{dpath}.tmp"
                                            with open(dtmp, "w", encoding="utf-8") as dfh:
                                                json.dump(ddata, dfh, ensure_ascii=False, indent=2)
                                            os.replace(dtmp, dpath)
                                        except OSError:
                                            pass
                            except FileNotFoundError:
                                pass
                        renamed = True
                        new_id = candidate
                        # Audit log (Phase 0.4) — opération critique multi-fichiers
                        audit_log("rename_annale", {
                            "oldId": aid,
                            "newId": candidate,
                            "metaUpdates": list(updates.keys()),
                        })
                    except OSError as e:
                        self._send_error(500, f"rename echoue : {e}")
                        return

            final_id = new_id if renamed else aid
            final_data = _annales_cache.get(final_id) or full
            self._send_json(200, {
                "updated": True,
                "id": final_id,
                "oldId": aid if renamed else None,
                "renamed": renamed,
                "fields": list(updates.keys()) + (["id"] if renamed else []),
                "summary": annale_summary(final_data),
                "redirectTo": f"/entrainement/{final_id}",
            })
            return

        m = re.match(r"^/api/captures/([A-Za-z0-9_\-]{1,80})$", url.path)
        if not m:
            self._send_error(404, "endpoint inconnu")
            return
        qid = m.group(1)
        file = capture_path(qid)
        if not os.path.isfile(file):
            self._send_error(404, "capture inconnue")
            return
        try:
            payload = self._read_json_body()
        except ValueError as e:
            self._send_error(400, str(e))
            return
        if not isinstance(payload, dict):
            self._send_error(400, "payload doit etre un objet JSON")
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
            self._send_error(400, "aucun champ editable fourni (customTitle, chapter)")
            return

        try:
            with open(file, "r", encoding="utf-8") as fh:
                question = json.load(fh)
        except (OSError, json.JSONDecodeError) as e:
            self._send_error(500, f"lecture impossible : {e}")
            return

        for key, value in updates.items():
            if value is None:
                question.pop(key, None)
            else:
                question[key] = value

        # Écriture atomique (Phase 0.2)
        try:
            write_json_file(file, question)
        except OSError as e:
            self._send_error(500, f"ecriture echouee : {e}")
            return

        self._send_json(200, {"updated": True, "id": qid, "fields": list(updates.keys())})

    def do_DELETE(self):
        url = urlparse(self.path)

        m_admin_img_delete = re.match(
            r"^/api/admin/annales/([A-Za-z0-9_\-]{1,80})/questions/([A-Za-z0-9_\-]{1,80})/images/([A-Za-z0-9_\-.]{1,200})$",
            url.path,
        )
        if m_admin_img_delete:
            handlers.annales.handle_admin_question_image_delete(
                self,
                annales_cache=_annales_cache,
                annale_path=annale_path,
                annale_images_dir=annale_images_dir,
                backup_manager=_backup_manager,
                write_json_file_fn=write_json_file,
                audit_log_fn=audit_log,
                aid=m_admin_img_delete.group(1),
                qid=m_admin_img_delete.group(2),
                filename=m_admin_img_delete.group(3),
            )
            return

        m_admin_delete_q = re.match(
            r"^/api/admin/annales/([A-Za-z0-9_\-]{1,80})/questions/([A-Za-z0-9_\-]{1,80})$",
            url.path,
        )
        if m_admin_delete_q:
            handlers.annales.handle_admin_question_delete(
                self,
                annales_cache=_annales_cache,
                annale_path=annale_path,
                sessions_dir=EXAM_SESSIONS_DIR,
                backup_manager=_backup_manager,
                write_json_file_fn=write_json_file,
                audit_log_fn=audit_log,
                aid=m_admin_delete_q.group(1),
                qid=m_admin_delete_q.group(2),
            )
            return

        # ── Phase 0.3 — Delete backup ────────────────────────────
        m_bak = re.match(r"^/api/admin/backups/(backup-\d{8}-\d{6}\.zip)$", url.path)
        if m_bak:
            handlers.admin.handle_backup_delete(
                self, backup_manager=_backup_manager, audit_log=audit_log,
                filename=m_bak.group(1),
            )
            return

        # DELETE /api/exam-sessions/<sessionId> — délégué à handlers.exam_sessions
        m_ses = re.match(r"^/api/exam-sessions/([A-Za-z0-9_\-]{1,80})$", url.path)
        if m_ses:
            handlers.exam_sessions.handle_session_delete(
                self, session_path=exam_session_path, audit_log=audit_log,
                session_id=m_ses.group(1),
            )
            return

        # DELETE /api/annales/drafts/<id> — délégué à handlers.qroc
        m_drf = re.match(r"^/api/annales/drafts/([A-Za-z0-9_\-]{1,80})$", url.path)
        if m_drf:
            handlers.qroc.handle_draft_delete(
                self,
                load_qroc_draft=load_qroc_draft,
                qroc_draft_path=qroc_draft_path,
                audit_log=audit_log,
                draft_id=m_drf.group(1),
            )
            return

        # DELETE /api/captures/<qid>/images/<imageId>
        m_img = re.match(r"^/api/captures/([A-Za-z0-9_\-]{1,80})/images/([A-Za-z0-9_\-]{1,80})$", url.path)
        if m_img:
            qid, image_id = m_img.group(1), m_img.group(2)
            file = capture_path(qid)
            if not os.path.isfile(file):
                self._send_error(404, "capture inconnue")
                return
            try:
                with open(file, "r", encoding="utf-8") as fh:
                    question = json.load(fh)
            except (OSError, json.JSONDecodeError) as e:
                self._send_error(500, f"lecture impossible : {e}")
                return
            before_imgs = len(question.get("images") or [])
            before_shots = len(question.get("screenshots") or [])
            if isinstance(question.get("images"), list):
                question["images"] = [i for i in question["images"] if i.get("id") != image_id]
            if isinstance(question.get("screenshots"), list):
                question["screenshots"] = [i for i in question["screenshots"] if i.get("id") != image_id]
            removed = (before_imgs - len(question.get("images") or [])) + (before_shots - len(question.get("screenshots") or []))
            if removed == 0:
                self._send_error(404, f"image '{image_id}' non trouvee")
                return
            # Écriture atomique (Phase 0.2)
            try:
                write_json_file(file, question)
            except OSError as e:
                self._send_error(500, f"ecriture echouee : {e}")
                return
            self._send_json(200, {"deleted": True, "imageId": image_id, "removed": removed})
            return

        m = re.match(r"^/api/captures/([A-Za-z0-9_\-]{1,80})$", url.path)
        if not m:
            self._send_error(404, "endpoint inconnu")
            return
        # DELETE /api/captures/<qid> — délégué à handlers.captures
        handlers.captures.handle_capture_delete(
            self, capture_path=capture_path, audit_log=audit_log,
            unregister_question_from_indexes=unregister_question_from_indexes,
            qid=m.group(1),
        )


def main():
    rebuild_indexes()
    load_annales()
    mark_interrupted_qroc_jobs()
    start_qroc_worker()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Hypocampus local server sur http://{HOST}:{PORT}")
    print(f"  data    : {DATA_DIR}")
    print(f"  annales : {ANNALES_DIR}")
    print(f"  web     : {WEB_DIR}")
    if not os.path.isdir(WEB_DIR):
        print(f"  ATTENTION : {WEB_DIR} n'existe pas. Lance start-server.bat pour builder.")
    print("Ctrl+C pour quitter.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArret.")
        server.server_close()


if __name__ == "__main__":
    main()
