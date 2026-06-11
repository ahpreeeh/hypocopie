import copy
import unittest

from tools.repair_qroc_vignettes import (
    apply_candidates,
    build_cumulative_vignettes,
    extract_vignette_from_source_block,
    find_repair_candidates,
)


def _draft():
    return {
        "id": "draft_test",
        "status": "published",
        "meta": {"annaleId": "neuro-test"},
        "sourceBlocks": [
            {
                "id": "sb2",
                "title": "QROC 2 - Test",
                "cleanText": (
                    "QROC 2 - Test\n"
                    "Vous recevez une patiente de 70 ans qui presente depuis 8 mois "
                    "un deficit progressif du membre superieur droit. Elle decrit "
                    "une perte de force et une impossibilite d'ecrire avec cette main.\n"
                    "QUESTION 1. Quel signe recherchez-vous ?\n"
                    "Reponse attendue\n"
                    "QUESTION 2. Quel diagnostic ?\n"
                    "Reponse attendue"
                ),
            }
        ],
        "generatedQuestions": [
            {"id": "q4", "_sourceBlockId": "sb2", "text": "Quel signe ?"},
            {"id": "q5", "_sourceBlockId": "sb2", "text": "Quel diagnostic ?"},
        ],
    }


def _annale():
    return {
        "id": "neuro-test",
        "questions": [
            {"id": "q4", "text": "Quel signe ?", "seriesId": None, "vignette": None},
            {"id": "q5", "text": "Quel diagnostic ?", "seriesId": None, "vignette": None},
        ],
    }


class TestExtractVignetteFromSourceBlock(unittest.TestCase):
    def test_extracts_intro_before_question_marker(self):
        block = _draft()["sourceBlocks"][0]
        vignette = extract_vignette_from_source_block(block)
        self.assertIsNotNone(vignette)
        self.assertIn("Vous recevez une patiente de 70 ans", vignette)
        self.assertNotIn("QUESTION 1", vignette)
        self.assertNotIn("QROC 2", vignette)

    def test_supports_numbered_question_marker(self):
        block = {
            "cleanText": (
                "QROC 3 - Test\n"
                "Un homme de 60 ans consulte aux urgences pour une dyspnee brutale. "
                "Il est admis en pneumologie pour bilan etiologique avec antecedents "
                "de BPCO moderee et HTA traitee.\n"
                "1. Quel examen demandez-vous ?\n"
                "Scanner thoracique"
            )
        }
        vignette = extract_vignette_from_source_block(block)
        self.assertIsNotNone(vignette)
        self.assertIn("Un homme de 60 ans", vignette)
        self.assertNotIn("Quel examen", vignette)

    def test_rejects_theoretical_block(self):
        block = {
            "cleanText": (
                "QROC 5 - Test\n"
                "Citez 5 facteurs de risque de psychose.\n"
                "QUESTION 1. Quels facteurs ?\n"
            )
        }
        self.assertIsNone(extract_vignette_from_source_block(block))

    def test_rejects_theoretical_child_development_block(self):
        block = {
            "cleanText": (
                "QROC 1 - Test\n"
                "Le developpement psychomoteur de l'enfant peut s'apprehender "
                "sur le mode d'une analyse polyaxiale du developpement ou dans "
                "le cadre d'un developpement circulaire.\n"
                "QUESTION 1. Citez les axes du developpement.\n"
            )
        }
        self.assertIsNone(extract_vignette_from_source_block(block))


class TestFindAndApplyRepairCandidates(unittest.TestCase):
    def test_finds_candidate_for_ungrouped_questions(self):
        candidates, skipped = find_repair_candidates(_draft(), _annale(), "neuro-test")
        self.assertEqual(skipped, [])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].question_ids, ["q4", "q5"])
        self.assertTrue(candidates[0].series_id.startswith("dp-sb2-"))

    def test_ignores_already_contextualized_series(self):
        annale = _annale()
        base = extract_vignette_from_source_block(_draft()["sourceBlocks"][0])
        annale["questions"][0]["seriesId"] = "dp-old"
        annale["questions"][0]["vignette"] = base
        annale["questions"][1]["seriesId"] = "dp-old"
        candidates, _skipped = find_repair_candidates(_draft(), annale, "neuro-test")
        self.assertEqual(candidates, [])

    def test_apply_updates_annale_and_draft(self):
        annale = _annale()
        draft = copy.deepcopy(_draft())
        candidates, _ = find_repair_candidates(draft, annale, "neuro-test")
        changed = apply_candidates(annale, draft, candidates)
        self.assertEqual(changed, 2)
        self.assertEqual(annale["questions"][0]["seriesFormat"], "DP")
        self.assertEqual(annale["questions"][0]["seriesPosition"], 1)
        self.assertEqual(annale["questions"][1]["seriesPosition"], 2)
        self.assertTrue(annale["questions"][0]["vignette"])
        self.assertIsNone(annale["questions"][1]["vignette"])
        self.assertEqual(
            draft["generatedQuestions"][0]["seriesId"],
            annale["questions"][0]["seriesId"],
        )
        self.assertIn("repairLog", draft)

    def test_builds_incremental_vignette_from_source_update(self):
        draft = {
            "id": "draft_incremental",
            "status": "published",
            "meta": {"annaleId": "neuro-test"},
            "sourceBlocks": [
                {
                    "id": "sb12",
                    "title": "QROC 12 - Test",
                    "cleanText": (
                        "QROC 12 - Test\n"
                        "Mr A., 76 ans, vous consulte car depuis 18 mois, il a l'impression "
                        "de tout oublier. Son epouse doit souvent lui repeter les informations.\n"
                        "1. Quel domaine cognitif semble atteint ?\n"
                        "Memoire episodique\n"
                        "Vous realisez un test du MMSE chez le patient, cote a 27/30. "
                        "Vous realisez un test des 5 mots, cote a 7/10. "
                        "Vous evaluez egalement l'autonomie de votre patient.\n"
                        "2. Quel est votre diagnostic syndromique complet ?\n"
                        "Troubles cognitifs legers touchant la memoire episodique"
                    ),
                }
            ],
            "generatedQuestions": [
                {
                    "id": "q1",
                    "_sourceBlockId": "sb12",
                    "sourceRefs": ["il a l'impression de tout oublier"],
                },
                {
                    "id": "q2",
                    "_sourceBlockId": "sb12",
                    "sourceRefs": ["Troubles cognitifs legers touchant la memoire episodique"],
                },
            ],
        }
        annale = {
            "id": "neuro-test",
            "questions": [
                {"id": "q1", "seriesId": None, "vignette": None},
                {"id": "q2", "seriesId": None, "vignette": None},
            ],
        }
        candidates, skipped = find_repair_candidates(draft, annale, "neuro-test")
        self.assertEqual(skipped, [])
        self.assertEqual(len(candidates), 1)
        planned = candidates[0].vignettes_by_qid
        self.assertIn("Mr A., 76 ans", planned["q1"])
        self.assertIn("Vous realisez un test du MMSE", planned["q2"])


if __name__ == "__main__":
    unittest.main()
