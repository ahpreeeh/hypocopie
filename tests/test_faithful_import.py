"""Tests pour le mode d'import « Autre » (transcription fidèle, profile=faithful).

Couvre :
- is_generic_question_start : détection générique de débuts de question (sans sur-découpe).
- _faithful_segments : découpage qui respecte les frontières + borne la taille + fallback.
- build_faithful_transcription_prompt : règles 1:1 / détection type / answerSource.
"""

import unittest

import server
from core.qroc_blocks import is_generic_question_start
from core.parsing import _faithful_segments


def _lines(texts):
    return [{"text": t} for t in texts]


class TestGenericQuestionStart(unittest.TestCase):
    def test_matches_numbered(self):
        for t in ["1. Quel diagnostic ?", "2) Citez", "12.Reponse", "3 ) test"]:
            self.assertTrue(is_generic_question_start(t), t)

    def test_matches_headers(self):
        for t in ["Question 3 :", "QCM 4", "Exercice 5", "Q1", "Item 7", "Cas clinique 2"]:
            self.assertTrue(is_generic_question_start(t), t)

    def test_matches_qroc_markers(self):
        self.assertTrue(is_generic_question_start("QROC 1 : biochimie"))
        self.assertTrue(is_generic_question_start("Dossier 2"))

    def test_ignores_plain_lines(self):
        # Pas de sur-découpe : une simple interrogative ou une ligne de contenu n'est pas un début.
        for t in ["Quel est le traitement ?", "Le patient a 45 ans", "", "anticorps anti-ilots"]:
            self.assertFalse(is_generic_question_start(t), t)


class TestFaithfulSegments(unittest.TestCase):
    def test_splits_multiple_questions(self):
        lines = _lines([f"{i}. Question {i} " + "x" * 200 for i in range(1, 11)])
        segs = _faithful_segments(lines, max_chars=600)
        self.assertGreater(len(segs), 1)
        # couvre toutes les lignes, contiguë, sans trou ni chevauchement
        self.assertEqual(segs[0][0], 0)
        self.assertEqual(segs[-1][1], len(lines))
        for (a, b), (c, d) in zip(segs, segs[1:]):
            self.assertEqual(b, c)

    def test_no_marker_falls_back_to_size_chunks(self):
        lines = _lines(["ligne sans marqueur " + "y" * 100 for _ in range(20)])
        segs = _faithful_segments(lines, max_chars=600)
        self.assertGreater(len(segs), 1)

    def test_small_input_single_segment(self):
        lines = _lines(["1. petite question"])
        segs = _faithful_segments(lines, max_chars=6000)
        self.assertEqual(segs, [(0, 1)])

    def test_does_not_split_mid_question(self):
        # 2 questions, lignes de suite ; sous max_chars → 1 segment, frontières intactes.
        lines = _lines(["1. Enonce", "suite a", "suite b", "2. Autre", "suite c"])
        segs = _faithful_segments(lines, max_chars=10000)
        self.assertEqual(segs, [(0, 5)])

    def test_empty(self):
        self.assertEqual(_faithful_segments([], max_chars=600), [])


class TestFaithfulPrompt(unittest.TestCase):
    def test_prompt_has_fidelity_rules(self):
        prompt = server.build_faithful_transcription_prompt(
            {"meta": {"subject": "Cardio"}},
            {"id": "sb1", "title": "Q1", "pages": [1], "cleanText": "1. Quel diagnostic ?", "images": []},
        )
        for needle in ["FIDELITE", "NE FUSIONNE PAS", "N'INVENTE PAS", "DETECTION DU TYPE", "answerSource", "source|ai"]:
            self.assertIn(needle, prompt)


if __name__ == "__main__":
    unittest.main()
