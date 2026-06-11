"""Tests pour core.text_utils (normalize, severity)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.text_utils import (
    fold_ascii,
    clean_pdf_text,
    int_or_none,
    normalize_question_id,
    qroc_source_warning,
    is_blocking_severity,
)


class TestFoldAscii(unittest.TestCase):

    def test_basic_lowercase(self):
        self.assertEqual(fold_ascii("HELLO"), "hello")

    def test_strip_accents(self):
        # ASCII fold simple (NFKD + retrait des combinaisons)
        self.assertEqual(fold_ascii("Café"), "cafe")
        self.assertEqual(fold_ascii("Élève"), "eleve")
        # Note : ligatures comme œ ne sont pas décomposées par NFKD seul,
        # elles sont simplement supprimées par encode("ascii", "ignore")
        self.assertEqual(fold_ascii("Cœur"), "cur")

    def test_none(self):
        self.assertEqual(fold_ascii(None), "")
        self.assertEqual(fold_ascii(""), "")


class TestCleanPdfText(unittest.TestCase):

    def test_basic(self):
        self.assertEqual(clean_pdf_text("  hello   world  "), "hello world")

    def test_pua_glyphs(self):
        # Glyphes UNESS spécifiques remplacés par espace
        text = "Question 1"
        self.assertEqual(clean_pdf_text(text), "Question 1")


class TestIntOrNone(unittest.TestCase):

    def test_valid_int(self):
        self.assertEqual(int_or_none(42), 42)
        self.assertEqual(int_or_none("100"), 100)

    def test_zero_returns_none(self):
        # Convention historique : 0 = "absent"
        self.assertIsNone(int_or_none(0))
        self.assertIsNone(int_or_none("0"))

    def test_invalid(self):
        self.assertIsNone(int_or_none("abc"))
        self.assertIsNone(int_or_none(None))
        self.assertIsNone(int_or_none([]))


class TestNormalizeQuestionId(unittest.TestCase):

    def test_keeps_valid(self):
        self.assertEqual(normalize_question_id("q1", 0), "q1")
        self.assertEqual(normalize_question_id("abc-123", 5), "abc-123")

    def test_slugifies_invalid(self):
        result = normalize_question_id("Question 1!", 0)
        self.assertTrue(result.startswith("question"))

    def test_fallback(self):
        self.assertEqual(normalize_question_id(None, 4), "q5")
        self.assertEqual(normalize_question_id("", 9), "q10")


class TestQrocSourceWarning(unittest.TestCase):

    def test_default_severity_from_blocking(self):
        w = qroc_source_warning("code1", "msg")
        self.assertEqual(w["severity"], "warning")  # blocking=False par défaut

    def test_blocking_implies_error(self):
        w = qroc_source_warning("code1", "msg", blocking=True)
        self.assertEqual(w["severity"], "error")

    def test_explicit_severity_wins(self):
        w = qroc_source_warning("code1", "msg", blocking=True, severity="info")
        self.assertEqual(w["severity"], "info")
        self.assertTrue(w["blocking"])  # Le flag reste

    def test_fields(self):
        w = qroc_source_warning("code1", "msg", severity="warning")
        self.assertEqual(w["code"], "code1")
        self.assertEqual(w["message"], "msg")
        self.assertIn("blocking", w)


class TestIsBlockingSeverity(unittest.TestCase):

    def test_error_blocks(self):
        self.assertTrue(is_blocking_severity("error"))

    def test_others_dont_block(self):
        self.assertFalse(is_blocking_severity("warning"))
        self.assertFalse(is_blocking_severity("info"))
        self.assertFalse(is_blocking_severity(None))


if __name__ == "__main__":
    unittest.main()
