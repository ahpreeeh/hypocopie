"""Tests pour core.models (dataclasses + validation)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.models import (
    Option,
    Question,
    AnnaleMeta,
    ExamSessionPayload,
    LocalImportMeta,
    AnnalePatchPayload,
    RegroupToDPPayload,
)


class TestOption(unittest.TestCase):

    def test_from_dict_valid(self):
        opt = Option.from_dict({"id": "A", "text": "Cardiopathie", "correct": True})
        self.assertEqual(opt.id, "A")
        self.assertEqual(opt.text, "Cardiopathie")
        self.assertTrue(opt.correct)

    def test_requires_text(self):
        with self.assertRaises(ValueError):
            Option.from_dict({"id": "A", "text": ""})


class TestQuestion(unittest.TestCase):

    def test_from_dict_qru(self):
        q = Question.from_dict({
            "id": "q1",
            "questionType": "QRU",
            "text": "Quel diagnostic ?",
            "options": [
                {"id": "A", "text": "IDM", "correct": True},
                {"id": "B", "text": "EP", "correct": False},
            ],
        })
        self.assertEqual(q.questionType, "QRU")
        self.assertEqual(len(q.options), 2)
        self.assertTrue(q.options[0].correct)

    def test_invalid_type(self):
        with self.assertRaises(ValueError):
            Question.from_dict({
                "id": "q1", "questionType": "XYZ", "text": "?",
            })


class TestExamSessionPayload(unittest.TestCase):

    def test_valid_exam_mode(self):
        s = ExamSessionPayload.from_dict({
            "annaleId": "cardio-2024",
            "mode": "exam",
            "answers": {"q1": ["A"]},
        })
        self.assertEqual(s.annaleId, "cardio-2024")
        self.assertEqual(s.mode, "exam")

    def test_valid_libre_mode(self):
        s = ExamSessionPayload.from_dict({
            "annaleId": "cardio-2024",
            "mode": "libre",
            "answers": {},
        })
        self.assertEqual(s.mode, "libre")

    def test_invalid_mode(self):
        with self.assertRaises(ValueError):
            ExamSessionPayload.from_dict({
                "annaleId": "x", "mode": "wrong", "answers": {},
            })

    def test_missing_annaleId(self):
        with self.assertRaises(ValueError):
            ExamSessionPayload.from_dict({"mode": "exam", "answers": {}})

    def test_answers_must_be_dict(self):
        with self.assertRaises(ValueError):
            ExamSessionPayload.from_dict({
                "annaleId": "x", "mode": "exam", "answers": [],
            })


class TestLocalImportMeta(unittest.TestCase):

    def test_valid(self):
        m = LocalImportMeta.from_dict({
            "annaleId": "cardio-2024-s1",
            "subject": "Cardiologie",
            "year": 2024,
            "session": "S1",
            "title": "Cardio 2024 S1",
        })
        self.assertEqual(m.annaleId, "cardio-2024-s1")
        self.assertEqual(m.year, 2024)

    def test_rejects_year_too_low(self):
        with self.assertRaises(ValueError):
            LocalImportMeta.from_dict({
                "annaleId": "x", "subject": "Cardio", "year": 1800, "title": "x",
            })

    def test_rejects_year_too_high(self):
        with self.assertRaises(ValueError):
            LocalImportMeta.from_dict({
                "annaleId": "x", "subject": "Cardio", "year": 2200, "title": "x",
            })


class TestAnnalePatchPayload(unittest.TestCase):

    def test_partial_update(self):
        p = AnnalePatchPayload.from_dict({"title": "Nouveau titre"})
        self.assertEqual(p.title, "Nouveau titre")
        self.assertIsNone(p.subject)
        self.assertIsNone(p.year)

    def test_rename(self):
        p = AnnalePatchPayload.from_dict({"newId": "cardio-2024-s1-v2"})
        self.assertEqual(p.newId, "cardio-2024-s1-v2")

    def test_empty_title_rejected(self):
        with self.assertRaises(ValueError):
            AnnalePatchPayload.from_dict({"title": "   "})

    def test_year_must_be_int(self):
        with self.assertRaises(ValueError):
            AnnalePatchPayload.from_dict({"year": "abc"})

    def test_has_changes(self):
        self.assertFalse(AnnalePatchPayload.from_dict({}).has_changes())
        self.assertTrue(AnnalePatchPayload.from_dict({"title": "x"}).has_changes())


class TestRegroupToDPPayload(unittest.TestCase):

    _VIGNETTE_OK = "Madame X, 78 ans, hypertendue, consulte pour dyspnée."

    def test_valid_default_format_is_dp(self):
        p = RegroupToDPPayload.from_dict({
            "questionIds": ["q1", "q2", "q3"],
            "seriesTitle": "Insuffisance cardiaque",
            "vignette": self._VIGNETTE_OK,
        })
        self.assertEqual(p.questionIds, ["q1", "q2", "q3"])
        self.assertEqual(p.seriesTitle, "Insuffisance cardiaque")
        self.assertEqual(p.seriesFormat, "DP")
        self.assertEqual(p.vignette, self._VIGNETTE_OK)

    def test_valid_kfp(self):
        p = RegroupToDPPayload.from_dict({
            "questionIds": ["q1", "q2"],
            "seriesTitle": "Choc septique",
            "vignette": self._VIGNETTE_OK,
            "seriesFormat": "KFP",
        })
        self.assertEqual(p.seriesFormat, "KFP")

    def test_rejects_less_than_two_questions(self):
        with self.assertRaises(ValueError):
            RegroupToDPPayload.from_dict({
                "questionIds": ["q1"],
                "seriesTitle": "x",
                "vignette": self._VIGNETTE_OK,
            })

    def test_rejects_duplicate_question_ids(self):
        with self.assertRaises(ValueError):
            RegroupToDPPayload.from_dict({
                "questionIds": ["q1", "q1"],
                "seriesTitle": "x",
                "vignette": self._VIGNETTE_OK,
            })

    def test_rejects_short_vignette(self):
        with self.assertRaises(ValueError):
            RegroupToDPPayload.from_dict({
                "questionIds": ["q1", "q2"],
                "seriesTitle": "x",
                "vignette": "trop court",
            })

    def test_rejects_invalid_format(self):
        with self.assertRaises(ValueError):
            RegroupToDPPayload.from_dict({
                "questionIds": ["q1", "q2"],
                "seriesTitle": "x",
                "vignette": self._VIGNETTE_OK,
                "seriesFormat": "QCM",
            })

    def test_rejects_non_string_question_id(self):
        with self.assertRaises(ValueError):
            RegroupToDPPayload.from_dict({
                "questionIds": ["q1", 42],
                "seriesTitle": "x",
                "vignette": self._VIGNETTE_OK,
            })

    def test_rejects_non_dict_payload(self):
        with self.assertRaises(ValueError):
            RegroupToDPPayload.from_dict(["not", "a", "dict"])


if __name__ == "__main__":
    unittest.main()
