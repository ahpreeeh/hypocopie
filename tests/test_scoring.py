import unittest

import server


class TestPartialScoring(unittest.TestCase):
    def setUp(self):
        self.annale = {
            "questions": [
                {
                    "id": "q1",
                    "questionType": "QRM",
                    "options": [
                        {"id": "A", "text": "A", "correct": True},
                        {"id": "B", "text": "B", "correct": True},
                        {"id": "C", "text": "C", "correct": False},
                        {"id": "D", "text": "D", "correct": False},
                    ],
                }
            ]
        }

    def score_for(self, answer):
        graded = server.grade_annale(self.annale, {"q1": answer})
        return graded["details"][0]["result"], graded["details"][0]["scoreValue"]

    def test_qrm_exact_is_one(self):
        self.assertEqual(self.score_for(["A", "B"]), ("juste", 1))

    def test_qrm_one_error_is_half(self):
        self.assertEqual(self.score_for(["A"]), ("partiel", 0.5))

    def test_qrm_two_errors_is_point_two(self):
        self.assertEqual(self.score_for(["A", "C"]), ("partiel", 0.2))

    def test_qrm_three_errors_is_zero(self):
        self.assertEqual(self.score_for(["C"]), ("faux", 0))

    def test_empty_qrm_is_zero(self):
        self.assertEqual(self.score_for([]), ("faux", 0))


if __name__ == "__main__":
    unittest.main()
