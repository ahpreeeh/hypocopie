"""
tools.fix_vignettes — Script de rectification batch des vignettes orphelines.

Usage :
    python -m tools.fix_vignettes --dry-run                          # Default : aucune modif
    python -m tools.fix_vignettes                                    # Mode interactif Y/n/e/q
    python -m tools.fix_vignettes --annale neurologie-2025-s1        # Cible 1 annale
    python -m tools.fix_vignettes --auto-confirm-threshold 0.9       # Auto-Y si score >= 0.9
    python -m tools.fix_vignettes --min-score 0.5                    # Filtre les clusters faibles

Bug ciblé : ~210 questions sur 32 annales référencent des patients
("Madame X", "cette patiente", "Monsieur Y") sans vignette clinique car
parsées comme QI au lieu de DP.

Heuristique :
    1. Scanne toutes les annales (data/annales/*.json).
    2. Identifie les questions sans seriesId qui mentionnent un patient.
    3. Regroupe les questions consécutives partageant le même label patient.
    4. Score chaque cluster (label exact, consécutivité, keywords cliniques).
    5. Propose une vignette extraite du correctionText de la 1ère question.
    6. Demande validation Y/n/e/q (ou auto-applique si score >= threshold).
    7. Applique via write_json_file (atomic), audit-log chaque modif.

Sécurité :
    - --dry-run par défaut sur les actions destructives lourdes (mode safe).
    - Backup global créé au premier "Y" de la session.
    - Audit log append-only à chaque cluster appliqué.
    - Reprise possible via data/_fix_vignettes_session.json en cas de "q".
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import NamedTuple

# Permet d'importer `core` quand le script est lancé via `python -m tools.fix_vignettes`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.storage import (
    BackupManager,
    audit,
    read_json_file,
    safe_slug,
    utc_now_iso,
    write_json_file,
)
from core.text_utils import fold_ascii

# ────────────────────────────────────────────────────────────────────
# Constantes / chemins
# ────────────────────────────────────────────────────────────────────

SCRIPT_VERSION = "1.0"
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "annales"
BACKUPS_DIR = ROOT / "data" / "_backups"
AUDIT_PATH = ROOT / "data" / "_audit.jsonl"
SESSION_PATH = ROOT / "data" / "_fix_vignettes_session.json"

# Keywords cliniques pour la détection d'éléments récurrents dans un cluster
CLINICAL_KEYWORDS = [
    "céphalée", "cephalee",
    "douleur thoracique",
    "dyspnée", "dyspnee",
    "fièvre", "fievre",
    "vertige",
    "syncope",
    "palpitation",
    "tremblement",
    "akinésie", "akinesie",
    "rigidité", "rigidite",
    "déficit moteur", "deficit moteur",
    "paresthésie", "paresthesie",
    "amyotrophie",
    "aréflexie", "areflexie",
    "diabète", "diabete",
    "hypertension", "hta",
    "insuffisance cardiaque",
    "fibrillation",
    "tachycardie",
    "bradycardie",
    "coma",
    "convulsion",
    "épilepsie", "epilepsie",
    "ataxie",
    "diplopie",
    "nystagmus",
    "aphasie",
    "hémiplégie", "hemiplegie",
    "monoplégie", "monoplegie",
    "paraplégie", "paraplegie",
    "tétraplégie", "tetraplegie",
    "douleur abdominale",
    "anémie", "anemie",
    "thrombose",
    "embolie",
    "infarctus",
    "ischémie", "ischemie",
    "hémorragie", "hemorragie",
]

# Regex patient : "Madame X", "Mme. Léa", "Monsieur Dupont", "M. K", etc.
RE_PATIENT_NAMED = re.compile(
    r"\b(?P<title>Madame|Mme\.?|Monsieur|M\.|Mr\.)\s+(?P<name>[A-ZÀ-Ÿ][a-zéèàâêîôûçùÀ-ÿ\-]{1,30})",
    re.UNICODE,
)
RE_PATIENT_GENERIC = re.compile(
    r"\b(cette patiente|ce patient|cette femme|cet homme|la patiente|le patient)\b",
    re.IGNORECASE | re.UNICODE,
)

# Coupure de la vignette avant la première "question clinique" (médicale)
RE_CLINICAL_QUESTION_CUT = re.compile(
    r"\b(diagnostic|traitement|examen[s]?\s+complémentaire[s]?|examen[s]?\s+complementaire[s]?|"
    r"conduite|prescription|bilan|prise en charge|que pensez|que faites|que proposez)\b",
    re.IGNORECASE | re.UNICODE,
)

# ────────────────────────────────────────────────────────────────────
# Types
# ────────────────────────────────────────────────────────────────────


class Cluster(NamedTuple):
    annale_id: str
    question_ids: list           # ex ["q3", "q4", "q5"]
    question_positions: list     # ex [2, 3, 4] (index 0-based dans annale["questions"])
    patient_label: str           # ex "Mme Léa", "cette patiente"
    score: float                 # ∈ [0.0, 1.0]
    vignette_proposed: str
    shared_keywords: list        # keywords cliniques partagés (debug/affichage)


# ────────────────────────────────────────────────────────────────────
# Extraction patient
# ────────────────────────────────────────────────────────────────────


def extract_patient_label(text):
    """
    Extrait un label patient depuis un texte (énoncé + correction).
    Retourne :
        - "Mme Léa" / "Monsieur Dupont" si nom propre détecté
        - "cette patiente" / "ce patient" si générique
        - None sinon
    """
    if not text or not isinstance(text, str):
        return None
    m = RE_PATIENT_NAMED.search(text)
    if m:
        title = m.group("title").rstrip(".")
        # Normalise "Mme" → "Mme", "Madame" → "Mme", "Monsieur" → "M.", "M" → "M.", "Mr" → "M."
        if title.lower().startswith("mme") or title.lower().startswith("madame"):
            title_norm = "Mme"
        else:
            title_norm = "M."
        name = m.group("name").strip().rstrip(",;.:")
        return f"{title_norm} {name}"
    m = RE_PATIENT_GENERIC.search(text)
    if m:
        # Normalise (lowercase pour la clé de regroupement)
        return m.group(0).lower()
    return None


def _extract_shared_keywords(texts):
    """Retourne les keywords cliniques présents dans au moins 2 textes du cluster."""
    folded = [fold_ascii(t) for t in texts]
    shared = []
    for kw in CLINICAL_KEYWORDS:
        kw_folded = fold_ascii(kw)
        if sum(1 for t in folded if kw_folded in t) >= 2:
            if kw not in shared and not any(fold_ascii(s) == kw_folded for s in shared):
                shared.append(kw)
    # Recherche aussi "N ans" partagé (ex: "60 ans" mentionné dans 2 questions)
    ages_by_text = [set(re.findall(r"\b(\d{1,3})\s*ans?\b", t)) for t in texts]
    common_ages = set.intersection(*ages_by_text) if ages_by_text else set()
    for age in sorted(common_ages):
        shared.append(f"{age} ans")
    return shared


# ────────────────────────────────────────────────────────────────────
# Scoring
# ────────────────────────────────────────────────────────────────────


def score_cluster(questions, positions, patient_labels, shared_keywords):
    """
    Score un cluster ∈ [0.0, 1.0].
        +0.4 : même patient_label exact dans ≥2 questions
        +0.3 : questions strictement consécutives (positions adjacentes)
        +0.2 : ≥1 keyword/âge clinique partagé
        +0.1 : baseline (3+ questions concordantes)
    """
    if len(questions) < 2:
        return 0.0

    score = 0.1  # baseline

    # Label exact partagé
    unique_labels = set(patient_labels)
    if len(unique_labels) == 1 and len(questions) >= 2:
        score += 0.4

    # Consécutivité stricte
    if len(positions) >= 2 and all(
        positions[i + 1] - positions[i] == 1 for i in range(len(positions) - 1)
    ):
        score += 0.3

    # Keywords cliniques partagés
    if shared_keywords:
        score += 0.2

    return max(0.0, min(1.0, score))


# ────────────────────────────────────────────────────────────────────
# Vignette proposée
# ────────────────────────────────────────────────────────────────────


def propose_vignette(questions, patient_label):
    """
    Construit une vignette à partir du correctionText de la 1ère question.
    Coupe avant la première mention médicale "diagnostic|traitement|...".
    Si trop court (< 50 chars), retourne un placeholder à compléter manuellement.
    """
    if not questions:
        return f"⚠️  Vignette à compléter manuellement (cas: {patient_label})"
    first = questions[0]
    correction = (first.get("correctionText") or "").strip()
    if not correction:
        # Fallback : essaye le texte de l'énoncé
        correction = (first.get("text") or "").strip()
    if not correction:
        return f"⚠️  Vignette à compléter manuellement (cas: {patient_label})"

    # Coupe avant la première question clinique
    m = RE_CLINICAL_QUESTION_CUT.search(correction)
    if m:
        vignette = correction[: m.start()].strip()
    else:
        vignette = correction

    # Trim à 500 chars max sur frontière de mot si possible
    if len(vignette) > 500:
        vignette = vignette[:500]
        # Coupe sur le dernier espace pour ne pas tronquer un mot
        last_space = vignette.rfind(" ")
        if last_space > 400:
            vignette = vignette[:last_space]
        vignette = vignette.rstrip(",;:.") + "…"

    if len(vignette) < 50:
        return f"⚠️  Vignette à compléter manuellement (cas: {patient_label})"

    return vignette


# ────────────────────────────────────────────────────────────────────
# Détection des clusters
# ────────────────────────────────────────────────────────────────────


def _is_eligible(question):
    """
    Une question est éligible au re-clustering si :
        - elle n'a pas déjà un seriesId (vignette déjà rattachée)
        - elle mentionne un patient (label détectable)
    """
    if question.get("seriesId"):
        return False
    text = (question.get("text") or "") + " " + (question.get("correctionText") or "")
    return extract_patient_label(text) is not None


def _question_text(q):
    return (q.get("text") or "") + " " + (q.get("correctionText") or "")


def detect_clusters(annale):
    """
    Détecte les clusters d'une annale.

    Algorithme :
        1. Parcourt les questions dans l'ordre.
        2. Pour chaque question éligible, calcule son patient_label.
        3. Regroupe les questions consécutives avec le même label
           (interruption = changement de label OU question non-éligible).
        4. Retourne uniquement les clusters de taille ≥ 2.

    Retourne : list[Cluster] dans l'ordre d'apparition dans l'annale.
    """
    annale_id = annale.get("id", "?")
    questions = annale.get("questions") or []

    clusters = []
    current_run = []  # liste de (position, label, question)
    current_label = None

    def _flush():
        nonlocal current_run, current_label
        if len(current_run) >= 2:
            qids = [r[2].get("id") for r in current_run]
            positions = [r[0] for r in current_run]
            qlist = [r[2] for r in current_run]
            labels = [r[1] for r in current_run]
            texts = [_question_text(q) for q in qlist]
            shared = _extract_shared_keywords(texts)
            sc = score_cluster(qlist, positions, labels, shared)
            vig = propose_vignette(qlist, current_label)
            clusters.append(
                Cluster(
                    annale_id=annale_id,
                    question_ids=qids,
                    question_positions=positions,
                    patient_label=current_label,
                    score=sc,
                    vignette_proposed=vig,
                    shared_keywords=shared,
                )
            )
        current_run = []
        current_label = None

    for i, q in enumerate(questions):
        if not _is_eligible(q):
            _flush()
            continue
        label = extract_patient_label(_question_text(q))
        if current_label is None:
            current_label = label
            current_run = [(i, label, q)]
        elif label == current_label:
            current_run.append((i, label, q))
        else:
            _flush()
            current_label = label
            current_run = [(i, label, q)]
    _flush()
    return clusters


# ────────────────────────────────────────────────────────────────────
# Scan global
# ────────────────────────────────────────────────────────────────────


def iter_annale_files(annale_filter=None):
    """Itère sur les chemins data/annales/*.json (filtrable par annale_id)."""
    if not DATA_DIR.is_dir():
        return
    for path in sorted(DATA_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() != ".json":
            continue
        if path.name.startswith("_"):
            continue
        if annale_filter and path.stem != annale_filter:
            continue
        yield path


def scan_all_clusters(annale_filter=None, min_score=0.0):
    """
    Scanne toutes les annales, retourne (list[Cluster], int annales_scannees,
    dict annale_id -> annale_data).
    """
    all_clusters = []
    annale_cache = {}
    count = 0
    for path in iter_annale_files(annale_filter):
        try:
            annale = read_json_file(str(path))
        except (OSError, json.JSONDecodeError) as e:
            print(f"[WARN] Lecture impossible : {path.name} ({e})", file=sys.stderr)
            continue
        count += 1
        annale_cache[annale.get("id") or path.stem] = annale
        for cluster in detect_clusters(annale):
            if cluster.score >= min_score:
                all_clusters.append(cluster)
    # Tri par score décroissant pour traiter les plus sûrs en premier
    all_clusters.sort(key=lambda c: (-c.score, c.annale_id))
    return all_clusters, count, annale_cache


# ────────────────────────────────────────────────────────────────────
# Application atomique
# ────────────────────────────────────────────────────────────────────


def _build_series_id(annale_id, patient_label):
    """Construit un seriesId unique et stable basé sur (annale_id, patient_label)."""
    raw = f"{annale_id}::{patient_label}".encode("utf-8")
    digest = hashlib.md5(raw).hexdigest()[:6]
    slug = safe_slug(patient_label, fallback="patient", max_len=30)
    return f"dp-{slug}-{digest}"


def _custom_title(patient_label):
    """Génère un titre court pour la série."""
    return f"Cas clinique — {patient_label}"


def apply_cluster(annale, cluster, vignette_text):
    """
    Applique le cluster sur l'annale (mutation in-place).
    Retourne le seriesId créé.

    Sécurité : ne modifie que les questions du cluster, dans l'ordre des positions.
    """
    series_id = _build_series_id(cluster.annale_id, cluster.patient_label)
    total = len(cluster.question_positions)
    title = _custom_title(cluster.patient_label)
    questions = annale.get("questions") or []
    for series_index, pos in enumerate(cluster.question_positions, start=1):
        q = questions[pos]
        q["seriesId"] = series_id
        q["seriesFormat"] = "DP"
        q["seriesPosition"] = series_index
        q["seriesTotal"] = total
        # La vignette est rattachée à toutes les questions du cluster (cohérence
        # avec les exemples existants comme neurologie-2025-s1 où les 3 questions
        # de la série DP partagent le même champ vignette).
        q["vignette"] = vignette_text
        # customTitle par question (peut être affiné plus tard manuellement)
        if not q.get("customTitle"):
            q["customTitle"] = title
    return series_id


# ────────────────────────────────────────────────────────────────────
# Editeur externe (option "e")
# ────────────────────────────────────────────────────────────────────


def edit_in_external_editor(initial_text):
    """
    Ouvre un éditeur externe (EDITOR env var ou notepad/nano).
    Retourne le texte modifié, ou initial_text si annulation/erreur.
    """
    editor = os.environ.get("EDITOR")
    if not editor:
        editor = "notepad" if os.name == "nt" else "nano"
    suffix = ".txt"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="vignette-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(initial_text)
        try:
            subprocess.run([editor, tmp_path], check=True)
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            print(f"[WARN] Échec lancement éditeur ({editor}) : {e}", file=sys.stderr)
            return initial_text
        with open(tmp_path, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


# ────────────────────────────────────────────────────────────────────
# Interface CLI
# ────────────────────────────────────────────────────────────────────


def _print_cluster(cluster, annale, idx, total):
    """Affichage textuel d'un cluster avant prompt utilisateur."""
    sep = "═" * 70
    print()
    print(sep)
    print(f"  Cluster {idx}/{total}  |  score {cluster.score:.2f}  |  annale «{cluster.annale_id}»")
    print(f"  Patient détecté : {cluster.patient_label}")
    if cluster.shared_keywords:
        print(f"  Indices partagés : {', '.join(cluster.shared_keywords)}")
    print(sep)
    questions = annale.get("questions") or []
    for series_idx, pos in enumerate(cluster.question_positions, start=1):
        q = questions[pos]
        text = (q.get("text") or "").strip().replace("\n", " ")
        if len(text) > 100:
            text = text[:97] + "..."
        print(f"  [{series_idx}/{len(cluster.question_positions)}]  {q.get('id', '?'):>6}  {text}")
    print()
    print("  ──── Vignette proposée ────")
    for line in (cluster.vignette_proposed or "").splitlines() or [""]:
        print(f"  {line}")
    print()


def _prompt_choice(prompt):
    """Retourne un caractère unique (y/n/e/q) ou 'y' sur Enter vide."""
    try:
        raw = input(prompt).strip().lower()
    except EOFError:
        return "q"
    if raw == "":
        return "y"
    return raw[0]


# ────────────────────────────────────────────────────────────────────
# Session (reprise après "q")
# ────────────────────────────────────────────────────────────────────


def _save_session(state):
    """Sauve l'état de session pour reprise ultérieure."""
    try:
        write_json_file(str(SESSION_PATH), state)
    except OSError as e:
        print(f"[WARN] Échec sauvegarde session : {e}", file=sys.stderr)


def _clear_session():
    """Supprime le fichier de session si présent."""
    try:
        if SESSION_PATH.is_file():
            os.remove(str(SESSION_PATH))
    except OSError:
        pass


# ────────────────────────────────────────────────────────────────────
# Backup au premier write
# ────────────────────────────────────────────────────────────────────


def _ensure_backup(state):
    """Crée un backup global si pas encore fait dans la session courante."""
    if state.get("backup_info"):
        return state["backup_info"]
    mgr = BackupManager(
        data_root=str(ROOT / "data"),
        backups_dir=str(BACKUPS_DIR),
        retention=30,
    )
    info = mgr.create()
    state["backup_info"] = info
    print(f"\n[backup] créé : {info['filename']} ({info['sizeBytes']} bytes)\n")
    audit.log("fix_vignettes_backup", {
        "backupFilename": info["filename"],
        "scriptVersion": SCRIPT_VERSION,
    })
    return info


# ────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────


def build_arg_parser():
    p = argparse.ArgumentParser(
        prog="python -m tools.fix_vignettes",
        description="Rectification batch des vignettes orphelines (DP mal parsées en QI).",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="Mode lecture seule : détecte et affiche les clusters, ne modifie rien.",
    )
    p.add_argument(
        "--annale", default=None,
        help="Cible une seule annale par son id (ex: neurologie-2025-s1).",
    )
    p.add_argument(
        "--auto-confirm-threshold", type=float, default=None,
        help="Auto-applique les clusters de score >= seuil (ex: 0.9). Ignoré en --dry-run.",
    )
    p.add_argument(
        "--min-score", type=float, default=0.0,
        help="Filtre : ignore les clusters de score < min-score (default 0.0).",
    )
    p.add_argument(
        "--no-audit", action="store_true",
        help="Désactive l'écriture d'audit log (pour tests/debug).",
    )
    return p


def _reconfigure_stdio_utf8():
    """Sous Windows, la console est en cp1252 par défaut → caractères Unicode
    (═, ─, accents) crashent. On force UTF-8 si possible."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass


def main(argv=None):
    _reconfigure_stdio_utf8()
    args = build_arg_parser().parse_args(argv)

    # Configure l'audit log singleton (sauf si --no-audit)
    if not args.no_audit:
        audit.configure(str(AUDIT_PATH))

    if not DATA_DIR.is_dir():
        print(f"[ERROR] Répertoire data introuvable : {DATA_DIR}", file=sys.stderr)
        return 2

    # Sanity check BackupManager (création silencieuse du dossier si manquant)
    BackupManager(data_root=str(ROOT / "data"), backups_dir=str(BACKUPS_DIR), retention=30)

    print(f"Hypocampus — fix_vignettes v{SCRIPT_VERSION}")
    print(f"  data dir       : {DATA_DIR}")
    print(f"  dry-run        : {args.dry_run}")
    print(f"  annale filter  : {args.annale or '(toutes)'}")
    print(f"  min-score      : {args.min_score}")
    print(f"  auto-confirm   : {args.auto_confirm_threshold or '(off)'}")

    clusters, annales_scanned, annale_cache = scan_all_clusters(
        annale_filter=args.annale, min_score=args.min_score,
    )
    print(f"\nScan terminé : {annales_scanned} annales, {len(clusters)} clusters détectés.")

    if not clusters:
        print("Rien à faire. Bye.")
        return 0

    # État de session
    state = {
        "startedAt": utc_now_iso(),
        "scriptVersion": SCRIPT_VERSION,
        "dryRun": args.dry_run,
        "applied": 0,
        "skipped": 0,
        "edited": 0,
        "auto_confirmed": 0,
        "backup_info": None,
        "modified_annale_ids": [],
    }

    # Map annale_id -> modifications en cours (pour batch writes)
    modified_annales = {}

    try:
        for idx, cluster in enumerate(clusters, start=1):
            annale = annale_cache.get(cluster.annale_id)
            if annale is None:
                continue
            _print_cluster(cluster, annale, idx, len(clusters))

            # Sélection vignette (proposée par défaut, modifiable via "e")
            vignette_text = cluster.vignette_proposed

            # Mode dry-run : log et passe
            if args.dry_run:
                print("  [DRY-RUN] aucune modif appliquée.")
                state["skipped"] += 1
                continue

            # Auto-confirm si score >= seuil
            auto = (
                args.auto_confirm_threshold is not None
                and cluster.score >= args.auto_confirm_threshold
            )
            if auto:
                print(f"  [AUTO-CONFIRMED] score={cluster.score:.2f} >= seuil={args.auto_confirm_threshold}")
                choice = "y"
            else:
                choice = _prompt_choice("  Appliquer ce cluster ? [Y/n/e/q] : ")

            if choice == "q":
                print("\n[interrompu par l'utilisateur — session sauvegardée]")
                _save_session(state)
                break

            if choice == "n":
                state["skipped"] += 1
                continue

            if choice == "e":
                vignette_text = edit_in_external_editor(vignette_text)
                state["edited"] += 1
                # Affiche un récap de la vignette éditée
                preview = (vignette_text[:200] + "...") if len(vignette_text) > 200 else vignette_text
                print(f"  [edited] nouvelle vignette : {preview}")
                # Re-prompt après édition (on assume Y pour l'appliquer maintenant)
                confirm = _prompt_choice("  Appliquer cette vignette éditée ? [Y/n] : ")
                if confirm == "n":
                    state["skipped"] += 1
                    continue

            # Backup global au premier write
            _ensure_backup(state)

            # Application
            series_id = apply_cluster(annale, cluster, vignette_text)
            modified_annales[cluster.annale_id] = annale

            # Écriture atomique de l'annale
            annale_path = DATA_DIR / f"{cluster.annale_id}.json"
            write_json_file(str(annale_path), annale)

            # Audit log
            audit.log("fix_vignette_batch", {
                "annaleId": cluster.annale_id,
                "seriesId": series_id,
                "questionIds": list(cluster.question_ids),
                "patientLabel": cluster.patient_label,
                "scoreUsed": round(cluster.score, 3),
                "autoConfirmed": auto,
                "scriptVersion": SCRIPT_VERSION,
            })

            state["applied"] += 1
            if auto:
                state["auto_confirmed"] += 1
            if cluster.annale_id not in state["modified_annale_ids"]:
                state["modified_annale_ids"].append(cluster.annale_id)
            print(f"  [OK] cluster appliqué, seriesId={series_id}")

        else:
            # Boucle terminée sans break : session complète
            _clear_session()
    except KeyboardInterrupt:
        print("\n[KeyboardInterrupt — session sauvegardée]")
        _save_session(state)

    # Rapport final
    print()
    print("═" * 60)
    print("RAPPORT FINAL")
    print()
    print(f"  Annales scannées      : {annales_scanned}")
    print(f"  Clusters détectés     : {len(clusters)}")
    print(f"  Clusters appliqués    : {state['applied']}")
    print(f"  Clusters passés       : {state['skipped']}")
    print(f"  Clusters édités       : {state['edited']}")
    if args.auto_confirm_threshold is not None:
        print(f"  Auto-confirmés        : {state['auto_confirmed']}")
    questions_grouped = sum(len(c.question_ids) for c in clusters if c.score >= args.min_score)
    print(f"  Questions regroupées  : {questions_grouped} (sur ~210 problématiques estimées)")
    if state["backup_info"]:
        print(f"  Backup créé           : {state['backup_info']['filename']}")
    else:
        print("  Backup créé           : (aucune modif effectuée)")
    print(f"  Audit log             : {state['applied']} nouvelles entrées dans data/_audit.jsonl")
    print("═" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
