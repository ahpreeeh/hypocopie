"""
tools.shuffle_options — Rectification batch du biais de position des bonnes réponses.

Scanne les annales publiées, détecte celles biaisées (taux de bonnes réponses
en position A trop élevé), propose un shuffle aléatoire des options avec
réassignation A→E. Backup automatique avant la première écriture, atomic
writes, audit log.

ATTENTION : shuffler une annale ayant des sessions d'examen historiques rend
les réponses stockées dans ces sessions incohérentes (l'option "A" n'est plus
la même). Le script détecte ces cas et demande confirmation par annale.

Usage :
    python -m tools.shuffle_options --dry-run            # safe par défaut
    python -m tools.shuffle_options                      # interactif Y/n
    python -m tools.shuffle_options --annale <id>        # cible 1 annale
    python -m tools.shuffle_options --threshold 0.4      # seuil biais (def 0.5)
    python -m tools.shuffle_options --auto-confirm       # auto-Y sans sessions
    python -m tools.shuffle_options --force              # accepter casser sessions
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

# Permettre l'import de core.* quand exécuté en script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.storage import write_json_file, audit as _audit, BackupManager  # noqa: E402
from core.options import measure_position_bias, shuffle_questions_options  # noqa: E402


ROOT = Path(__file__).resolve().parent.parent
ANNALES_DIR = ROOT / "data" / "annales"
SESSIONS_DIR = ROOT / "data" / "exam-sessions"

SCRIPT_VERSION = "1.1"


def _reconfigure_stdio_utf8() -> None:
    """Force UTF-8 sur la console Windows pour les caractères Unicode."""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name)
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8")
            except Exception:
                pass


def load_annale(path: Path) -> dict | None:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def list_annale_files(annale_id: str | None = None) -> list[Path]:
    if not ANNALES_DIR.is_dir():
        return []
    files = []
    for name in sorted(os.listdir(ANNALES_DIR)):
        if not name.endswith(".json"):
            continue
        if name.startswith("_"):
            continue
        if annale_id and name[:-5] != annale_id:
            continue
        files.append(ANNALES_DIR / name)
    return files


def session_count_for_annale(annale_id: str) -> int:
    """Retourne le nombre de sessions historiques qui pointent vers cette annale."""
    if not SESSIONS_DIR.is_dir():
        return 0
    count = 0
    for name in os.listdir(SESSIONS_DIR):
        if not name.endswith(".json"):
            continue
        path = SESSIONS_DIR / name
        try:
            with open(path, "r", encoding="utf-8") as fh:
                s = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        if s.get("annaleId") == annale_id:
            count += 1
    return count


def format_bias_summary(stats: dict, total_q: int) -> str:
    ratio = stats["firstCorrectAtARatio"]
    a_count = stats["firstCorrectAtA"]
    qrm5 = stats["qrmFirstNAllCorrect"].get(5, 0) + stats["qrmFirstNAllCorrect"].get(4, 0)
    return (
        f"  total: {total_q} q | options non-vides: {stats['totalWithOptions']}\n"
        f"  1ere bonne en A : {a_count} ({ratio:.1%})\n"
        f"  distribution    : {stats['positionDistribution']}\n"
        f"  >=4 premieres correctes : {qrm5}"
    )


def prompt_yes_no(question: str, default_no: bool = False) -> bool:
    suffix = "[y/N]" if default_no else "[Y/n]"
    try:
        ans = input(f"{question} {suffix} ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return False
    if not ans:
        return not default_no
    return ans in {"y", "yes", "o", "oui"}


def main(argv: list[str] | None = None) -> int:
    _reconfigure_stdio_utf8()

    parser = argparse.ArgumentParser(
        description="Shuffle des options pour corriger le biais de position des bonnes réponses.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="N'applique rien, affiche seulement les annales candidates (defaut: applique en mode interactif).",
    )
    parser.add_argument(
        "--annale",
        type=str,
        default=None,
        help="Limite a une annale precise (par id).",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.5,
        help="Ratio min de bonnes reponses en A pour considerer biaisee (defaut: 0.5).",
    )
    parser.add_argument(
        "--auto-confirm",
        action="store_true",
        default=False,
        help="Auto-Y sur les annales sans session historique (sans demander).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Accepte de shuffler meme si l'annale a des sessions (casse l'historique).",
    )
    args = parser.parse_args(argv)

    files = list_annale_files(args.annale)
    if not files:
        target = args.annale or "(toutes)"
        print(f"Aucune annale trouvee pour : {target}")
        return 1

    print(f"Scan : {len(files)} annale(s) | seuil biais : {args.threshold:.0%}")
    print(f"Mode : {'DRY-RUN' if args.dry_run else 'INTERACTIF' + (' + auto-confirm' if args.auto_confirm else '')}")
    print("=" * 60)

    candidates = []
    for path in files:
        annale = load_annale(path)
        if not annale:
            continue
        annale_id = annale.get("id") or path.stem
        questions = annale.get("questions") or []
        stats = measure_position_bias(questions)
        if stats["totalWithOptions"] == 0:
            continue
        if stats["firstCorrectAtARatio"] < args.threshold:
            continue
        candidates.append({
            "path": path,
            "annale_id": annale_id,
            "annale": annale,
            "stats": stats,
            "session_count": session_count_for_annale(annale_id),
        })

    if not candidates:
        print("Aucune annale biaisee au-dessus du seuil.")
        return 0

    print(f"\n{len(candidates)} annale(s) candidate(s) au shuffle :\n")

    applied = 0
    skipped_sessions = 0
    skipped_user = 0
    backup_created = False

    for c in candidates:
        annale_id = c["annale_id"]
        annale = c["annale"]
        stats = c["stats"]
        nq = len(annale.get("questions") or [])
        print(f"\n--- {annale_id} ---")
        print(format_bias_summary(stats, nq))
        print(f"  sessions historiques : {c['session_count']}")

        if args.dry_run:
            print("  -> DRY-RUN, aucune modif.")
            continue

        if c["session_count"] > 0 and not args.force:
            print("  -> SKIP (sessions historiques presentes, utiliser --force pour bypass).")
            skipped_sessions += 1
            continue

        if args.auto_confirm and c["session_count"] == 0:
            apply = True
        else:
            apply = prompt_yes_no("  Appliquer le shuffle ?", default_no=False)

        if not apply:
            print("  -> SKIP utilisateur.")
            skipped_user += 1
            continue

        # Backup global au premier apply
        if not backup_created:
            try:
                data_root = str(ROOT / "data")
                backups_dir = str(ROOT / "data" / "_backups")
                bm = BackupManager(data_root=data_root, backups_dir=backups_dir)
                backup_info = bm.create()
                bpath = backup_info.get("path") if isinstance(backup_info, dict) else str(backup_info)
                print(f"  [backup] {bpath}")
                backup_created = True
            except Exception as e:
                print(f"  [backup] ECHEC : {e}")
                print("  ABORT : un backup est obligatoire avant de muter les annales.")
                return 2

        # Snapshot avant pour audit
        n_shuffled = shuffle_questions_options(
            annale.get("questions") or [],
            rng=random.Random(f"shuffle-options:{annale_id}"),
        )
        try:
            write_json_file(str(c["path"]), annale)
        except OSError as e:
            print(f"  -> echec ecriture : {e}")
            continue

        # Stats post-shuffle pour vérif
        new_stats = measure_position_bias(annale.get("questions") or [])
        print(f"  -> applique : {n_shuffled} q. shufflees | nouveau ratio A: {new_stats['firstCorrectAtARatio']:.1%}")

        try:
            _audit.log("shuffle_options_batch", {
                "annaleId": annale_id,
                "questionsShuffled": n_shuffled,
                "biasBefore": stats["firstCorrectAtARatio"],
                "biasAfter": new_stats["firstCorrectAtARatio"],
                "sessionsImpacted": c["session_count"],
                "scriptVersion": SCRIPT_VERSION,
            })
        except Exception as e:
            print(f"  [audit] echec : {e}")

        applied += 1

    print("\n" + "=" * 60)
    print("RAPPORT FINAL")
    print("-" * 60)
    print(f"Candidates detectees : {len(candidates)}")
    print(f"Appliquees           : {applied}")
    print(f"Sautees (sessions)   : {skipped_sessions}")
    print(f"Sautees (utilisateur): {skipped_user}")
    if args.dry_run:
        print("Mode DRY-RUN : aucune modification ecrite.")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
