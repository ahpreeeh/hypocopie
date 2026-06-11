"""Tests pour la provenance answerSource — corrige genere par IA quand absent du PDF.

Couvre :
- build_qroc_generation_prompt : le prompt est bimodal (source vs ai).
- normalize_qroc_generated_questions : capture/defaut/validation de answerSource + infos.
- validate_imported_annale : answerSource survit a la publication (regression cle).
- grade_annale / grade_one_question : answerSource present dans les details.
"""

import unittest

import server


class TestPromptBimodal(unittest.TestCase):
    def test_prompt_mentions_both_modes(self):
        prompt = server.build_qroc_generation_prompt(
            {"meta": {"subject": "Endoc"}},
            {"id": "sb1", "title": "Bloc 1", "pages": [1], "cleanText": "Question 1 ...", "images": []},
        )
        self.assertIn("answerSource", prompt)
        self.assertIn('answerSource="source"', prompt)
        self.assertIn('answerSource="ai"', prompt)
        self.assertIn("PROVENANCE DE LA REPONSE", prompt)
        self.assertIn("connaissances medicales", prompt)


class TestNormalizeAnswerSource(unittest.TestCase):
    BLOCK = {"id": "sb1", "cleanText": "bloc"}

    def _normalize(self, raw):
        return server.normalize_qroc_generated_questions([raw], self.BLOCK)

    def test_ai_captured(self):
        questions, _, _, _ = self._normalize(
            {"id": "q1", "questionType": "QROC", "text": "Q", "answerSource": "ai", "expectedAnswer": "Peptide C"}
        )
        self.assertEqual(questions[0]["answerSource"], "ai")

    def test_source_captured(self):
        questions, _, _, _ = self._normalize(
            {"id": "q1", "questionType": "QROC", "text": "Q", "answerSource": "source", "expectedAnswer": "X"}
        )
        self.assertEqual(questions[0]["answerSource"], "source")

    def test_default_is_source(self):
        questions, _, _, _ = self._normalize(
            {"id": "q1", "questionType": "QROC", "text": "Q", "expectedAnswer": "X"}
        )
        self.assertEqual(questions[0]["answerSource"], "source")

    def test_invalid_falls_back_to_source(self):
        questions, _, _, _ = self._normalize(
            {"id": "q1", "questionType": "QROC", "text": "Q", "answerSource": "GARBAGE", "expectedAnswer": "X"}
        )
        self.assertEqual(questions[0]["answerSource"], "source")

    def test_ai_qroc_without_answer_skips_complete_manually_info(self):
        _, _, _, infos = self._normalize(
            {"id": "q1", "questionType": "QROC", "text": "Q", "answerSource": "ai"}
        )
        joined = " ".join(infos)
        self.assertNotIn("a completer manuellement", joined)
        self.assertIn("generee par IA", joined)

    def test_source_qroc_without_answer_warns_complete_manually(self):
        _, _, _, infos = self._normalize(
            {"id": "q1", "questionType": "QROC", "text": "Q", "answerSource": "source"}
        )
        joined = " ".join(infos)
        self.assertIn("a completer manuellement", joined)
        self.assertNotIn("generee par IA", joined)


class TestValidatePreservesAnswerSource(unittest.TestCase):
    META = {"id": "a1", "title": "T", "subject": "Endoc", "year": 2025, "session": "S1"}

    def _validate(self, question):
        normalized, _ = server.validate_imported_annale({"questions": [question]}, self.META)
        return normalized["questions"][0]

    def test_ai_preserved_qroc(self):
        q = self._validate(
            {"id": "q1", "questionType": "QROC", "text": "Q", "answerSource": "ai", "expectedAnswer": "R"}
        )
        self.assertEqual(q["answerSource"], "ai")

    def test_default_source_when_absent(self):
        q = self._validate(
            {"id": "q1", "questionType": "QROC", "text": "Q", "expectedAnswer": "R"}
        )
        self.assertEqual(q["answerSource"], "source")

    def test_ai_preserved_qru(self):
        q = self._validate({
            "id": "q1", "questionType": "QRU", "text": "Q", "answerSource": "ai",
            "options": [
                {"id": "A", "text": "bon", "correct": True},
                {"id": "B", "text": "faux", "correct": False},
            ],
        })
        self.assertEqual(q["answerSource"], "ai")


class TestGradeIncludesAnswerSource(unittest.TestCase):
    def setUp(self):
        self.annale = {
            "questions": [
                {"id": "q1", "questionType": "QROC", "text": "Q", "answerSource": "ai", "expectedAnswer": "R"},
                {
                    "id": "q2", "questionType": "QRU", "text": "Q2", "answerSource": "source",
                    "options": [
                        {"id": "A", "text": "a", "correct": True},
                        {"id": "B", "text": "b", "correct": False},
                    ],
                },
            ]
        }

    def test_grade_annale_details_carry_answer_source(self):
        graded = server.grade_annale(self.annale, {"q2": ["A"]})
        by_id = {d["qid"]: d for d in graded["details"]}
        self.assertEqual(by_id["q1"]["answerSource"], "ai")
        self.assertEqual(by_id["q2"]["answerSource"], "source")

    def test_grade_one_question_carries_answer_source(self):
        detail = server.grade_one_question(self.annale, "q1", "ma reponse")
        self.assertEqual(detail["answerSource"], "ai")


if __name__ == "__main__":
    unittest.main()
