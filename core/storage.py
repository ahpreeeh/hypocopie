"""
core.storage — Helpers I/O + sécurité IDs + audit log + backups.

Module zéro-dépendance vis-à-vis du reste du code applicatif. Tout ce qui
touche au filesystem (lecture/écriture JSON, validation d'identifiants,
backups, audit log) est centralisé ici pour éviter la duplication.

Issu de Phase 1 de la modularisation. Importé depuis server.py.
"""

import json
import os
import re
import sys
import threading
import zipfile
from datetime import datetime, timezone


# ────────────────────────────────────────────────────────────────────
# Sécurité IDs / noms de fichiers
# ────────────────────────────────────────────────────────────────────

# IDs autorisés : alphanum, underscore, tiret. Bloque path traversal.
SAFE_ID = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")


def safe_filename(value):
    """
    Retourne le nom de fichier si valide, None sinon.
    Bloque les caractères dangereux, les .. et les paths absolus.
    """
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value:
        return None
    if not re.match(r"^[A-Za-z0-9_\-.]{1,200}$", value) or ".." in value:
        return None
    return value


def safe_slug(value, fallback="item", max_len=80):
    """
    Slugifie une chaîne (lowercase, sans accents, alphanum + tirets, max `max_len` chars).
    Retourne `fallback` si le résultat est vide.
    """
    import unicodedata
    value = unicodedata.normalize("NFKD", str(value or ""))
    value = value.encode("ascii", "ignore").decode("ascii").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    if not value:
        value = fallback
    return value[:max_len].strip("-") or fallback


def utc_now_iso():
    """Timestamp ISO 8601 en UTC pour les écritures audit/log."""
    return datetime.now(timezone.utc).isoformat()


# ────────────────────────────────────────────────────────────────────
# I/O JSON atomique (.tmp + os.replace)
# ────────────────────────────────────────────────────────────────────

# Lock global pour toutes les opérations fichiers JSON.
# Pas le plus granulaire possible mais suffit pour un single-user local.
FILE_LOCK = threading.Lock()


def read_json_file(path: str):
    """Lecture protégée d'un fichier JSON. Lève les erreurs OSError/JSONDecodeError au caller."""
    with FILE_LOCK:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)


def write_json_file(path: str, data):
    """
    Écriture atomique d'un fichier JSON via .tmp + os.replace().
    Garantit qu'un crash en cours d'écriture ne corrompt pas le fichier existant.
    """
    with FILE_LOCK:
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)


# ────────────────────────────────────────────────────────────────────
# Audit log append-only (Phase 0.4)
# ────────────────────────────────────────────────────────────────────


class AuditLog:
    """
    Logger append-only thread-safe.
    Configuré au démarrage de l'app via configure(path).
    """

    def __init__(self):
        self._path = None
        self._lock = threading.Lock()

    def configure(self, path: str):
        self._path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)

    def log(self, action: str, details=None):
        if not self._path:
            return  # silencieux si non configuré
        entry = {
            "at": utc_now_iso(),
            "action": action,
            "details": details if details is not None else {},
        }
        try:
            with self._lock:
                with open(self._path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError as e:
            print(f"[audit] échec écriture log : {e}", file=sys.stderr)


# Instance singleton utilisée par tout le projet.
audit = AuditLog()


# ────────────────────────────────────────────────────────────────────
# Backups (Phase 0.3)
# ────────────────────────────────────────────────────────────────────


class BackupManager:
    """
    Gère les zips horodatés de data/ → data/_backups/.
    Cleanup automatique : ne garde que les N derniers (configurable).
    Thread-safe.
    """

    def __init__(self, data_root: str, backups_dir: str, retention: int = 30):
        self.data_root = data_root
        self.backups_dir = backups_dir
        self.retention = retention
        self._lock = threading.Lock()
        os.makedirs(backups_dir, exist_ok=True)

    def create(self):
        """Crée un zip horodaté et retourne les métadonnées."""
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        filename = f"backup-{timestamp}.zip"
        target = os.path.join(self.backups_dir, filename)
        with self._lock:
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
                for dirpath, _, filenames in os.walk(self.data_root):
                    # Skip le dossier des backups eux-mêmes (récursion infinie)
                    if os.path.commonpath([dirpath, self.backups_dir]) == self.backups_dir:
                        continue
                    for name in filenames:
                        full = os.path.join(dirpath, name)
                        rel = os.path.relpath(full, os.path.dirname(self.data_root))
                        try:
                            zf.write(full, arcname=rel)
                        except OSError:
                            pass
            size = os.path.getsize(target)
        self.cleanup_old()
        return {
            "filename": filename,
            "path": os.path.relpath(target, os.path.dirname(self.data_root)),
            "sizeBytes": size,
            "createdAt": utc_now_iso(),
        }

    def list_backups(self):
        """Liste les backups disponibles, du plus récent au plus ancien."""
        if not os.path.isdir(self.backups_dir):
            return []
        entries = []
        for name in os.listdir(self.backups_dir):
            if not name.startswith("backup-") or not name.endswith(".zip"):
                continue
            full = os.path.join(self.backups_dir, name)
            try:
                stat = os.stat(full)
            except OSError:
                continue
            entries.append({
                "filename": name,
                "sizeBytes": stat.st_size,
                "createdAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
        entries.sort(key=lambda e: e["createdAt"], reverse=True)
        return entries

    def delete(self, filename: str):
        """Supprime un backup donné. Retourne True si supprimé, False sinon."""
        if not re.match(r"^backup-\d{8}-\d{6}\.zip$", filename):
            return False
        full = os.path.join(self.backups_dir, filename)
        if not os.path.isfile(full):
            return False
        try:
            os.remove(full)
            return True
        except OSError:
            return False

    def cleanup_old(self):
        """Garde uniquement les `retention` derniers backups."""
        backups = self.list_backups()
        if len(backups) <= self.retention:
            return
        for old in backups[self.retention:]:
            try:
                os.remove(os.path.join(self.backups_dir, old["filename"]))
            except OSError:
                pass


# ────────────────────────────────────────────────────────────────────
# Reports store (signalements de coquilles de parsing par l'utilisateur)
# ────────────────────────────────────────────────────────────────────


class ReportStore:
    """
    Stockage des signalements utilisateur de coquilles de parsing.
    Format : JSONL append-only (1 ligne = 1 entry).

    Pattern d'usage : POST /api/reports → append() ; GET → list() ;
    PATCH status=resolved → mark_resolved() (rewrite atomique du fichier complet).

    Volume attendu : faible (~10/an). Pas de pagination ni d'index pour le moment.
    Si volume explose, prévoir compaction (suppression des resolved anciens).
    """

    def __init__(self, reports_path: str):
        self.path = reports_path
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(reports_path), exist_ok=True)

    def append(self, report: dict) -> None:
        """Ajoute un report au fichier JSONL. report doit déjà être validé."""
        with self._lock:
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(report, ensure_ascii=False) + "\n")

    def _read_all(self) -> list:
        """Lecture interne, retourne tous les reports (ordre d'écriture)."""
        if not os.path.isfile(self.path):
            return []
        entries = []
        with open(self.path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # tolérant aux lignes corrompues
        return entries

    def list(self, status_filter: str = "open") -> list:
        """
        Liste les reports, filtrés par status.
        status_filter ∈ {"open", "resolved", "all"}. Default "open".
        """
        with self._lock:
            entries = self._read_all()
        if status_filter == "all":
            return entries
        return [e for e in entries if (e.get("status") or "open") == status_filter]

    def get(self, report_id: str) -> dict | None:
        """Récupère 1 report par id, None si absent."""
        with self._lock:
            for entry in self._read_all():
                if entry.get("id") == report_id:
                    return entry
        return None

    def mark_resolved(self, report_id: str) -> bool:
        """
        Marque un report comme resolved. Rewrite atomique complet du fichier.
        Retourne True si trouvé et modifié, False si l'id n'existe pas.
        """
        with self._lock:
            entries = self._read_all()
            found = False
            for entry in entries:
                if entry.get("id") == report_id and entry.get("status") != "resolved":
                    entry["status"] = "resolved"
                    entry["resolvedAt"] = utc_now_iso()
                    found = True
            if not found:
                return False
            # Rewrite atomique via .tmp
            tmp_path = f"{self.path}.tmp"
            with open(tmp_path, "w", encoding="utf-8") as fh:
                for entry in entries:
                    fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
            os.replace(tmp_path, self.path)
            return True
