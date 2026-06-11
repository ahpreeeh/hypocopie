"""Tests pour core.options — shuffle des options + diagnostic biais."""

from __future__ import annotations

import random
import unittest

from core.options import (
    OPTION_LETTERS,
    measure_position_bias,
    shuffle_question_options,
    shuffle_questions_options,
)


class TestShuffleQuestionOptions(unittest.TestCase):

    def _make_q(self, n=5, correct_at=(0,)):
        def _initial_id(i):
            return OPTION_LETTERS[i] if i < len(OPTION_LETTERS) else f"O{i + 1}"
        opts = [
            {"id": _initial_id(i), "text": f"opt-{i}", "correct": i in correct_at}
            for i in range(n)
        ]
        return {"id": "q1", "questionType": "QRU", "options": opts}

    def test_noop_when_no_options(self):
        q = {"id": "q1", "text": "QROC sans options"}
        shuffle_question_options(q)
        self.assertNotIn("options", q)

    def test_noop_when_single_option(self):
        q = {"id": "q1", "options": [{"id": "A", "text": "seule", "correct": True}]}
        shuffle_question_options(q)
        self.assertEqual(len(q["options"]), 1)
        self.assertEqual(q["options"][0]["id"], "A")

    def test_noop_when_options_not_list(self):
        q = {"id": "q1", "options": "broken"}
        shuffle_question_options(q)
        self.assertEqual(q["options"], "broken")

    def test_noop_when_option_not_dict(self):
        q = {"id": "q1", "options": ["A", "B"]}
        shuffle_question_options(q)
        # Pas de crash, structure conservée
        self.assertEqual(q["options"], ["A", "B"])

    def test_reassigns_ids_alphabetically(self):
        q = self._make_q(n=4)
        rng = random.Random(42)
        shuffle_question_options(q, rng=rng)
        ids = [o["id"] for o in q["options"]]
        self.assertEqual(ids, ["A", "B", "C", "D"])

    def test_preserves_correct_count(self):
        q = self._make_q(n=5, correct_at=(0, 2, 4))
        before_correct = sum(1 for o in q["options"] if o["correct"])
        rng = random.Random(7)
        shuffle_question_options(q, rng=rng)
        after_correct = sum(1 for o in q["options"] if o["correct"])
        self.assertEqual(before_correct, after_correct)

    def test_seeded_shuffle_is_reproducible(self):
        q1 = self._make_q(n=5, correct_at=(0,))
        q2 = self._make_q(n=5, correct_at=(0,))
        shuffle_question_options(q1, rng=random.Random(123))
        shuffle_question_options(q2, rng=random.Random(123))
        self.assertEqual(
            [o["text"] for o in q1["options"]],
            [o["text"] for o in q2["options"]],
        )

    def test_extended_letters_for_many_options(self):
        # 7 options → ids A..G
        q = self._make_q(n=7, correct_at=(0,))
        shuffle_question_options(q, rng=random.Random(1))
        self.assertEqual([o["id"] for o in q["options"]], list("ABCDEFG"))

    def test_more_than_letters_uses_fallback(self):
        # 12 options → A..L
        q = self._make_q(n=12, correct_at=(0,))
        shuffle_question_options(q, rng=random.Random(1))
        expected = list("ABCDEFGHIJKL")
        self.assertEqual([o["id"] for o in q["options"]], expected)

    def test_fallback_after_fifteen_options(self):
        q = self._make_q(n=16, correct_at=(0,))
        shuffle_question_options(q, rng=random.Random(1))
        self.assertEqual([o["id"] for o in q["options"]], list(OPTION_LETTERS) + ["O16"])


class TestShuffleQuestionsOptions(unittest.TestCase):

    def test_bulk_shuffle_counts_only_questions_with_options(self):
        qs = [
            {"id": "q1", "options": [{"id": "A", "text": "a", "correct": True},
                                       {"id": "B", "text": "b", "correct": False}]},
            {"id": "q2"},  # pas d'options → skip
            {"id": "q3", "options": [{"id": "A", "text": "c", "correct": True}]},  # 1 option → skip
            {"id": "q4", "options": [{"id": "A", "text": "d", "correct": True},
                                       {"id": "B", "text": "e", "correct": False},
                                       {"id": "C", "text": "f", "correct": False}]},
        ]
        n = shuffle_questions_options(qs, rng=random.Random(0))
        self.assertEqual(n, 2)

    def test_bulk_shuffle_balances_first_correct_position(self):
        qs = [
            {"id": f"q{i}", "options": [
                {"id": "A", "text": "correct", "correct": True},
                {"id": "B", "text": "wrong-1", "correct": False},
                {"id": "C", "text": "wrong-2", "correct": False},
                {"id": "D", "text": "wrong-3", "correct": False},
            ]}
            for i in range(4)
        ]
        shuffle_questions_options(qs, rng=random.Random(0))
        positions = []
        for q in qs:
            positions.append(next(i for i, opt in enumerate(q["options"]) if opt["correct"]))
        self.assertEqual(positions, [0, 1, 2, 3])


class TestMeasurePositionBias(unittest.TestCase):

    def test_perfect_bias_first_correct_at_a(self):
        qs = [
            {"options": [{"id": "A", "correct": True}, {"id": "B", "correct": False}]},
            {"options": [{"id": "A", "correct": True}, {"id": "B", "correct": False}, {"id": "C", "correct": True}]},
        ]
        stats = measure_position_bias(qs)
        self.assertEqual(stats["totalWithOptions"], 2)
        self.assertEqual(stats["firstCorrectAtA"], 2)
        self.assertEqual(stats["firstCorrectAtARatio"], 1.0)

    def test_distribution_correct(self):
        qs = [
            {"options": [{"id": "A", "correct": False}, {"id": "B", "correct": True}]},
            {"options": [{"id": "A", "correct": False}, {"id": "B", "correct": False}, {"id": "C", "correct": True}]},
            {"options": [{"id": "A", "correct": True}]},  # 1 option → distrib mais pas shuffle
        ]
        stats = measure_position_bias(qs)
        self.assertEqual(stats["positionDistribution"], {0: 1, 1: 1, 2: 1})
        self.assertEqual(stats["firstCorrectAtA"], 1)

    def test_qrm_first_n_all_correct(self):
        # 5 options, 4 premières correctes → cocher 2, 3, 4 (pas 5)
        qs = [
            {"options": [
                {"id": "A", "correct": True}, {"id": "B", "correct": True},
                {"id": "C", "correct": True}, {"id": "D", "correct": True},
                {"id": "E", "correct": False},
            ]},
        ]
        stats = measure_position_bias(qs)
        self.assertEqual(stats["qrmFirstNAllCorrect"][2], 1)
        self.assertEqual(stats["qrmFirstNAllCorrect"][3], 1)
        self.assertEqual(stats["qrmFirstNAllCorrect"][4], 1)
        self.assertEqual(stats["qrmFirstNAllCorrect"][5], 0)

    def test_empty(self):
        stats = measure_position_bias([])
        self.assertEqual(stats["totalWithOptions"], 0)
        self.assertEqual(stats["firstCorrectAtARatio"], 0.0)


if __name__ == "__main__":
    unittest.main()
