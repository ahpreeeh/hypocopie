"""Tests pour tools.shuffle_options — smoke + helpers."""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# Permettre l'import depuis tools/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class TestShuffleOptionsHelpers(unittest.TestCase):

    def test_format_bias_summary_runs(self):
        from tools.shuffle_options import format_bias_summary
        stats = {
            "totalWithOptions": 10,
            "firstCorrectAtA": 7,
            "firstCorrectAtARatio": 0.7,
            "positionDistribution": {0: 7, 1: 2, 2: 1},
            "qrmFirstNAllCorrect": {2: 5, 3: 3, 4: 2, 5: 1},
        }
        out = format_bias_summary(stats, total_q=10)
        self.assertIn("10", out)
        self.assertIn("70", out)  # ratio formatted as percentage

    def test_prompt_yes_no_default(self):
        from tools.shuffle_options import prompt_yes_no
        with mock.patch("builtins.input", return_value=""):
            self.assertTrue(prompt_yes_no("Q?", default_no=False))
            self.assertFalse(prompt_yes_no("Q?", default_no=True))
        with mock.patch("builtins.input", return_value="y"):
            self.assertTrue(prompt_yes_no("Q?", default_no=True))
        with mock.patch("builtins.input", return_value="n"):
            self.assertFalse(prompt_yes_no("Q?", default_no=False))


class TestShuffleOptionsDryRun(unittest.TestCase):
    """Smoke test : dry-run sur fixture temporaire ne modifie aucun fichier."""

    def test_dry_run_preserves_mtimes(self):
        # Fixture : crée un dossier annales avec 1 annale biaisée
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            annales = tmp / "data" / "annales"
            sessions = tmp / "data" / "exam-sessions"
            annales.mkdir(parents=True)
            sessions.mkdir(parents=True)
            annale_file = annales / "test-annale.json"
            annale_data = {
                "id": "test-annale",
                "title": "Test",
                "questions": [
                    {
                        "id": "q1",
                        "questionType": "QRU",
                        "options": [
                            {"id": "A", "text": "good", "correct": True},
                            {"id": "B", "text": "bad", "correct": False},
                            {"id": "C", "text": "bad", "correct": False},
                        ],
                    },
                ],
            }
            annale_file.write_text(json.dumps(annale_data, ensure_ascii=False), encoding="utf-8")
            mtime_before = annale_file.stat().st_mtime_ns

            # Patch les chemins du module pour pointer vers la fixture
            from tools import shuffle_options as so
            with mock.patch.object(so, "ANNALES_DIR", annales), \
                 mock.patch.object(so, "SESSIONS_DIR", sessions):
                # Capture stdout pour ne pas polluer
                with mock.patch("sys.stdout", new_callable=io.StringIO):
                    rc = so.main(["--dry-run", "--threshold", "0.5"])
                self.assertEqual(rc, 0)

            mtime_after = annale_file.stat().st_mtime_ns
            self.assertEqual(mtime_before, mtime_after, "dry-run ne doit pas modifier les fichiers")


if __name__ == "__main__":
    unittest.main()
