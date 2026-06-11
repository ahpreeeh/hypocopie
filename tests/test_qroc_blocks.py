"""Tests pour core.qroc_blocks (stats blocs source, validation, détection)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.qroc_blocks import (
    source_block_stats,
    validate_source_block,
    is_qroc_block_start,
)


class TestSourceBlockStats(unittest.TestCase):

    def test_empty(self):
        stats = source_block_stats("")
        self.assertEqual(stats["chars"], 0)
        self.assertEqual(stats["questionMarkers"], 0)
        self.assertEqual(stats["answerLines"], 0)

    def test_counts_chars(self):
        stats = source_block_stats("Bonjour monde")
        self.assertEqual(stats["chars"], 13)

    def test_counts_question_markers(self):
        # "Question 1)" et "2." et "3)" sont des markers
        text = "Question 1) lorem\n2. ipsum\n3) dolor sit amet"
        stats = source_block_stats(text)
        self.assertGreaterEqual(stats["questionMarkers"], 3)

    def test_counts_instruction_markers(self):
        # Verbes d'instruction médicaux
        text = "Citez les principaux signes. Quel diagnostic ? Donnez le traitement."
        stats = source_block_stats(text)
        self.assertGreater(stats["instructionMarkers"], 0)

    def test_counts_answer_lines(self):
        # Lignes de plus de 3 chars
        text = "Line one\nab\nLine three plus longue\n    \nLast line"
        stats = source_block_stats(text)
        # "Line one", "Line three plus longue", "Last line" = 3 lignes utiles
        self.assertGreaterEqual(stats["answerLines"], 3)


class TestValidateSourceBlock(unittest.TestCase):

    def test_short_block_error(self):
        block = {"cleanText": "trop court"}  # < 120 chars
        result = validate_source_block(block)
        self.assertGreater(len(result["warnings"]), 0)
        codes = [w["code"] for w in result["warnings"]]
        self.assertIn("short-block", codes)
        severities = [w["severity"] for w in result["warnings"]]
        self.assertIn("error", severities)

    def test_long_block_error(self):
        block = {"cleanText": "x" * 13000}  # > 12000 chars
        result = validate_source_block(block)
        codes = [w["code"] for w in result["warnings"]]
        self.assertIn("long-block", codes)

    def test_normal_block_no_critical_warning(self):
        # Bloc valide avec markers de question
        text = (
            "DP1 — Cardio.\n"
            "Vignette clinique : Madame X, 60 ans, douleur thoracique. "
            "Question 1) Quel diagnostic ? Citez les examens. "
            "Question 2) Quel traitement prescrivez-vous ? "
            "Question 3) Citez les facteurs de risque cardiovasculaire. "
            "Question 4) Donnez les complications possibles."
        )
        block = {"cleanText": text}
        result = validate_source_block(block)
        # Pas d'erreur bloquante attendue
        errors = [w for w in result["warnings"] if w["severity"] == "error"]
        self.assertEqual(len(errors), 0, f"Erreurs inattendues : {errors}")

    def test_warnings_override_accepted_downgrades(self):
        block = {"cleanText": "trop court", "warningsOverride": "accepted"}
        result = validate_source_block(block)
        # Tous les warnings doivent être non-bloquants
        for w in result["warnings"]:
            self.assertFalse(w["blocking"])
            self.assertTrue(w.get("accepted"))


class TestIsQrocBlockStart(unittest.TestCase):

    def test_qroc_pattern(self):
        self.assertTrue(is_qroc_block_start("QROC 1 : Diagnostic"))
        self.assertTrue(is_qroc_block_start("qroc 5 énoncé"))

    def test_dossier_pattern(self):
        self.assertTrue(is_qroc_block_start("Dossier 2 : Cas clinique"))
        self.assertTrue(is_qroc_block_start("Cas 3 — Patient X"))

    def test_normal_text_not_block_start(self):
        self.assertFalse(is_qroc_block_start("Le patient présente"))
        self.assertFalse(is_qroc_block_start("Question 1"))  # pas "QROC"
        self.assertFalse(is_qroc_block_start(""))


if __name__ == "__main__":
    unittest.main()
