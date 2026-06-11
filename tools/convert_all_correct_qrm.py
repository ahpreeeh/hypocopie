"""Convert all-correct QRM questions to QROC.

All-correct QRM are a generation artifact: with no false distractor, answer A
is necessarily correct whatever the shuffle. The honest representation is a
free-answer question with the official list as expectedAnswer.

Usage:
    python -m tools.convert_all_correct_qrm
    python -m tools.convert_all_correct_qrm --apply
    python -m tools.convert_all_correct_qrm --annale neurologie-2024-s1 --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.storage import BackupManager, audit, write_json_file  # noqa: E402


ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = ROOT / "data"
ANNALES_DIR = DATA_ROOT / "annales"
BACKUPS_DIR = DATA_ROOT / "_backups"
AUDIT_PATH = DATA_ROOT / "_audit.jsonl"
SCRIPT_VERSION = "1.0"


def _annale_files(annale_filter: set[str] | None = None) -> list[Path]:
    files: list[Path] = []
    if not ANNALES_DIR.is_dir():
        return files
    for name in sorted(os.listdir(ANNALES_DIR)):
        if not name.endswith(".json") or name.startswith("_"):
            continue
        stem = name[:-5]
        if annale_filter and stem not in annale_filter:
            continue
        files.append(ANNALES_DIR / name)
    return files


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def find_all_correct_questions(annale: dict[str, Any]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for question in annale.get("questions") or []:
        if not isinstance(question, dict):
            continue
        if str(question.get("questionType") or "").upper() not in {"QRM", "QRU"}:
            continue
        options = question.get("options")
        if not isinstance(options, list) or len(options) < 2:
            continue
        if all(isinstance(option, dict) and option.get("correct") for option in options):
            found.append(question)
    return found


def convert_question(question: dict[str, Any]) -> None:
    options = [option for option in (question.get("options") or []) if isinstance(option, dict)]
    expected_lines = [str(option.get("text") or "").strip() for option in options if str(option.get("text") or "").strip()]
    existing_correction = str(question.get("correctionText") or "").strip()
    if not existing_correction:
        existing_correction = "Réponses attendues :\n" + "\n".join(f"- {line}" for line in expected_lines)

    question["questionType"] = "QROC"
    question["options"] = None
    question["expectedAnswer"] = "\n".join(expected_lines)
    question["correctionText"] = existing_correction


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Convertit les QRM/QRU tout-vrai en QROC.")
    parser.add_argument("--apply", action="store_true", help="Ecrit les modifications. Defaut: dry-run.")
    parser.add_argument("--annale", action="append", default=None, help="Limiter a une annale.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    audit.configure(str(AUDIT_PATH))
    annale_filter = set(args.annale or []) or None

    candidates: list[tuple[Path, dict[str, Any], list[dict[str, Any]]]] = []
    for path in _annale_files(annale_filter):
        annale = _read_json(path)
        if not annale:
            continue
        questions = find_all_correct_questions(annale)
        if questions:
            candidates.append((path, annale, questions))

    print(f"convert_all_correct_qrm v{SCRIPT_VERSION}")
    print(f"mode: {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"annales candidates: {len(candidates)}")
    for path, annale, questions in candidates:
        annale_id = annale.get("id") or path.stem
        print(f"- {annale_id}: {len(questions)} question(s)")
        for question in questions:
            print(f"  {question.get('id')}: {str(question.get('text') or '')[:120]}")

    if not args.apply:
        print("\n[DRY-RUN] aucune modification ecrite.")
        return 0
    if not candidates:
        print("Rien a appliquer.")
        return 0

    backup_manager = BackupManager(str(DATA_ROOT), str(BACKUPS_DIR), retention=30)
    backup_info = backup_manager.create()
    print(f"\nbackup cree: {backup_info['filename']}")

    converted = 0
    for path, annale, questions in candidates:
        for question in questions:
            convert_question(question)
            converted += 1
        write_json_file(str(path), annale)
        audit.log(
            "convert_all_correct_qrm",
            {
                "annaleId": annale.get("id") or path.stem,
                "questionIds": [q.get("id") for q in questions],
                "scriptVersion": SCRIPT_VERSION,
                "backupFilename": backup_info["filename"],
            },
        )

    print(f"converties: {converted} question(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
