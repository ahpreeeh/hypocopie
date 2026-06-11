import unittest

from core.annale_admin import normalize_admin_question, normalize_series_metadata, validate_annale_admin


class TestNormalizeAdminQuestion(unittest.TestCase):
    def test_reassigns_option_ids_and_allows_15_options(self):
        q = normalize_admin_question({
            "id": "q1",
            "questionType": "QRM",
            "text": "Question",
            "options": [
                {"id": "Z", "text": f"Option {i}", "correct": i in (0, 14)}
                for i in range(15)
            ],
        })
        self.assertEqual(q["options"][0]["id"], "A")
        self.assertEqual(q["options"][-1]["id"], "O")
        self.assertEqual(sum(1 for opt in q["options"] if opt["correct"]), 2)

    def test_rejects_invalid_qru_correct_count(self):
        with self.assertRaises(ValueError):
            normalize_admin_question({
                "id": "q1",
                "questionType": "QRU",
                "text": "Question",
                "options": [
                    {"text": "A", "correct": True},
                    {"text": "B", "correct": True},
                ],
            })

    def test_preserves_images_on_full_replace(self):
        q = normalize_admin_question({
            "id": "q1",
            "questionType": "QROC",
            "text": "Interpretez l'ECG.",
            "expectedAnswer": "FA",
            "image": "q1.png",
            "images": [{"id": "img_1", "filename": "q1.png"}],
        })
        self.assertEqual(q["image"], "q1.png")
        self.assertEqual(q["images"][0]["filename"], "q1.png")


class TestValidateAnnaleAdmin(unittest.TestCase):
    def test_flags_qru_with_two_correct_answers(self):
        report = validate_annale_admin({
            "id": "a",
            "questions": [{
                "id": "q1",
                "questionType": "QRU",
                "text": "Question",
                "options": [
                    {"id": "A", "text": "A", "correct": True},
                    {"id": "B", "text": "B", "correct": True},
                ],
            }],
        })
        self.assertFalse(report["ok"])
        self.assertTrue(any(i["code"] == "qru-correct-count" for i in report["issues"]))

    def test_flags_missing_image_as_warning(self):
        report = validate_annale_admin({
            "id": "a",
            "questions": [{
                "id": "q1",
                "questionType": "QROC",
                "text": "Interpretez l'ECG ci-dessous.",
                "expectedAnswer": "FA",
            }],
        })
        self.assertTrue(any(i["code"] == "image-expected-missing" for i in report["issues"]))
        self.assertEqual(report["counts"]["error"], 0)

    def test_normalize_series_metadata_recomputes_totals(self):
        annale = {
            "questions": [
                {"id": "q1", "questionType": "QROC", "text": "A", "expectedAnswer": "A", "seriesId": "dp1", "seriesFormat": "DP", "seriesTotal": 99},
                {"id": "q2", "questionType": "QROC", "text": "B", "expectedAnswer": "B", "seriesId": "dp1", "seriesFormat": "DP"},
            ],
        }
        normalize_series_metadata(annale)
        self.assertEqual(annale["questions"][0]["seriesPosition"], 1)
        self.assertEqual(annale["questions"][1]["seriesPosition"], 2)
        self.assertEqual(annale["questions"][0]["seriesTotal"], 2)


if __name__ == "__main__":
    unittest.main()
