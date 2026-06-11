"""Tests pour tools.fix_vignettes (extraction patient, clustering, scoring,
proposition vignette, smoke dry-run).

Le script utilise des helpers purs (sans I/O réseau) testables en isolation.
Le smoke dry-run vérifie qu'aucun fichier n'est modifié dans data/annales/.

Compatible unittest (`python -m unittest`) ET pytest.
"""

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

# Path setup : permet d'importer `tools.fix_vignettes`
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from tools import fix_vignettes as fv
from tools.fix_vignettes import (
    Cluster,
    detect_clusters,
    extract_patient_label,
    main,
    propose_vignette,
    score_cluster,
)


# ────────────────────────────────────────────────────────────────────
# extract_patient_label
# ────────────────────────────────────────────────────────────────────


class TestExtractPatientLabel(unittest.TestCase):

    def test_madame_with_name(self):
        label = extract_patient_label("Vous recevez Madame Léa, 35 ans, pour…")
        self.assertEqual(label, "Mme Léa")

    def test_mme_abbreviated_normalized(self):
        label = extract_patient_label("Mme Dupont consulte pour douleur thoracique.")
        self.assertEqual(label, "Mme Dupont")

    def test_monsieur_normalized_to_m_dot(self):
        label = extract_patient_label("Monsieur Bernard, 60 ans, présente une dyspnée.")
        self.assertEqual(label, "M. Bernard")

    def test_generic_cette_patiente(self):
        label = extract_patient_label("Quel diagnostic évoquer chez cette patiente ?")
        self.assertEqual(label, "cette patiente")

    def test_returns_none_when_no_patient(self):
        self.assertIsNone(extract_patient_label("Quel est le diagnostic ?"))
        self.assertIsNone(extract_patient_label(""))
        self.assertIsNone(extract_patient_label(None))

    def test_ce_patient_generic(self):
        label = extract_patient_label("L'examen de ce patient révèle un souffle.")
        self.assertEqual(label, "ce patient")


# ────────────────────────────────────────────────────────────────────
# detect_clusters
# ────────────────────────────────────────────────────────────────────


def _q(qid, text="", correction=""):
    """Helper construit une question minimale."""
    return {"id": qid, "text": text, "correctionText": correction}


class TestDetectClusters(unittest.TestCase):

    def test_three_consecutive_same_label_makes_one_cluster(self):
        annale = {
            "id": "test-annale",
            "questions": [
                _q("q1", "Mme Léa, 40 ans, consulte. Quel diagnostic ?",
                   "Mme Léa présente une céphalée typique."),
                _q("q2", "Quel examen complémentaire chez Mme Léa ?",
                   "Mme Léa bénéficiera d'une IRM cérébrale."),
                _q("q3", "Quel traitement chez Mme Léa ?",
                   "Mme Léa reçoit un triptan."),
            ],
        }
        clusters = detect_clusters(annale)
        self.assertEqual(len(clusters), 1)
        c = clusters[0]
        self.assertEqual(c.annale_id, "test-annale")
        self.assertEqual(c.question_ids, ["q1", "q2", "q3"])
        self.assertEqual(c.patient_label, "Mme Léa")
        self.assertGreaterEqual(c.score, 0.8)

    def test_interrupted_by_non_eligible_no_cluster(self):
        annale = {
            "id": "test-2",
            "questions": [
                _q("q1", "Mme Léa, 40 ans.", "Patient adulte."),
                # Question intercalaire générique : pas de patient
                _q("q2", "Quelle est la définition de la polyglobulie ?", "Définition générale."),
                _q("q3", "Mme Léa retourne.", "Mme Léa toujours suivie."),
            ],
        }
        clusters = detect_clusters(annale)
        # q1 seul (taille 1), q3 seul → aucun cluster ≥2
        self.assertEqual(len(clusters), 0)

    def test_already_seriesid_skipped(self):
        annale = {
            "id": "test-3",
            "questions": [
                {**_q("q1", "Mme Léa.", "Mme Léa va bien."), "seriesId": "dp-old"},
                {**_q("q2", "Mme Léa.", "Mme Léa toujours."), "seriesId": "dp-old"},
                _q("q3", "Mme Léa.", "Mme Léa encore."),
                _q("q4", "Mme Léa.", "Mme Léa toujours là."),
            ],
        }
        clusters = detect_clusters(annale)
        # q1, q2 ont déjà seriesId → ignorées. q3+q4 forment un cluster.
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0].question_ids, ["q3", "q4"])

    def test_different_labels_dont_merge(self):
        annale = {
            "id": "test-4",
            "questions": [
                _q("q1", "Mme Léa consulte.", "Mme Léa va bien."),
                _q("q2", "Monsieur Paul consulte.", "Monsieur Paul aussi."),
            ],
        }
        clusters = detect_clusters(annale)
        # Deux labels différents, runs séparés de taille 1 → 0 cluster
        self.assertEqual(len(clusters), 0)


# ────────────────────────────────────────────────────────────────────
# score_cluster
# ────────────────────────────────────────────────────────────────────


class TestScoreCluster(unittest.TestCase):

    def test_ideal_cluster_high_score(self):
        # 3 questions consécutives, même label, keyword partagé → score >= 0.9
        qs = [_q("q1"), _q("q2"), _q("q3")]
        positions = [4, 5, 6]
        labels = ["Mme Léa"] * 3
        shared = ["céphalée"]
        score = score_cluster(qs, positions, labels, shared)
        self.assertGreaterEqual(score, 0.9)

    def test_single_question_returns_zero(self):
        score = score_cluster([_q("q1")], [0], ["Mme Léa"], [])
        self.assertEqual(score, 0.0)

    def test_score_capped_at_one(self):
        qs = [_q(f"q{i}") for i in range(5)]
        positions = [0, 1, 2, 3, 4]
        labels = ["Mme Léa"] * 5
        shared = ["céphalée", "vertige", "60 ans"]
        score = score_cluster(qs, positions, labels, shared)
        self.assertLessEqual(score, 1.0)

    def test_non_consecutive_loses_03(self):
        qs = [_q("q1"), _q("q2")]
        positions = [0, 5]  # pas consécutifs
        labels = ["Mme Léa"] * 2
        shared = []
        score_non_consec = score_cluster(qs, positions, labels, shared)
        score_consec = score_cluster(qs, [0, 1], labels, shared)
        self.assertGreater(score_consec, score_non_consec)
        self.assertAlmostEqual(score_consec - score_non_consec, 0.3, places=2)


# ────────────────────────────────────────────────────────────────────
# propose_vignette
# ────────────────────────────────────────────────────────────────────


class TestProposeVignette(unittest.TestCase):

    def test_extracts_from_correction_text(self):
        q = _q("q1", "Quel diagnostic ?",
               "Mme Léa, 35 ans, présente des céphalées pulsatiles unilatérales "
               "avec photophobie depuis 24h. Le diagnostic le plus probable est…")
        vignette = propose_vignette([q], "Mme Léa")
        # Doit contenir la vignette clinique avant "diagnostic"
        self.assertIn("Mme Léa", vignette)
        self.assertIn("35 ans", vignette)
        # Doit couper avant le mot "diagnostic"
        self.assertNotIn("le plus probable", vignette)

    def test_cut_before_keyword(self):
        q = _q("q1", "Énoncé.",
               "Patient de 60 ans, douleur thoracique typique. "
               "Quel traitement instituer en urgence ?")
        vignette = propose_vignette([q], "ce patient")
        self.assertIn("douleur thoracique", vignette)
        self.assertNotIn("Quel traitement", vignette)

    def test_short_correction_falls_back_to_placeholder(self):
        q = _q("q1", "Énoncé.", "Court.")
        vignette = propose_vignette([q], "Mme Léa")
        self.assertIn("compléter manuellement", vignette)

    def test_truncation_at_500_chars(self):
        long_text = "Patient. " + ("Anamnèse clinique très détaillée. " * 50)
        q = _q("q1", "Énoncé.", long_text)
        vignette = propose_vignette([q], "ce patient")
        # Tolérance pour l'ellipsis ajoutée
        self.assertLessEqual(len(vignette), 510)


# ────────────────────────────────────────────────────────────────────
# Smoke test dry-run : 0 fichier modifié
# ────────────────────────────────────────────────────────────────────


class TestDryRunSmoke(unittest.TestCase):
    """Le smoke test crée une fake DATA_DIR temporaire, lance --dry-run dessus,
    vérifie qu'aucun fichier n'est modifié (mtime stable)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fix_vignettes_test_")
        self.annales_dir = Path(self.tmp) / "annales"
        self.annales_dir.mkdir(parents=True)
        # Annale piège : 2 questions consécutives même patient → 1 cluster détectable
        self.annale = {
            "id": "smoke-test",
            "title": "Smoke",
            "subject": "test",
            "year": 2024,
            "session": 1,
            "questions": [
                {"id": "q1", "text": "Mme Léa, 40 ans, consulte.",
                 "correctionText": "Mme Léa présente une céphalée. Diagnostic ?",
                 "seriesId": None},
                {"id": "q2", "text": "Quel examen chez Mme Léa ?",
                 "correctionText": "IRM cérébrale chez Mme Léa.",
                 "seriesId": None},
            ],
        }
        self.annale_path = self.annales_dir / "smoke-test.json"
        with open(self.annale_path, "w", encoding="utf-8") as fh:
            json.dump(self.annale, fh, ensure_ascii=False, indent=2)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_dry_run_does_not_modify(self):
        # Capture mtime initial
        mtime_before = os.path.getmtime(self.annale_path)
        size_before = os.path.getsize(self.annale_path)

        # Patch les paths globaux pour cibler la fake dir
        with mock.patch.object(fv, "DATA_DIR", self.annales_dir), \
             mock.patch.object(fv, "AUDIT_PATH", Path(self.tmp) / "_audit.jsonl"), \
             mock.patch.object(fv, "BACKUPS_DIR", Path(self.tmp) / "_backups"), \
             mock.patch.object(fv, "SESSION_PATH", Path(self.tmp) / "_session.json"):
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = main(["--dry-run", "--no-audit"])
            output = buf.getvalue()

        self.assertEqual(rc, 0)
        # Aucune écriture
        self.assertEqual(os.path.getmtime(self.annale_path), mtime_before)
        self.assertEqual(os.path.getsize(self.annale_path), size_before)
        # Aucun backup créé
        self.assertFalse((Path(self.tmp) / "_backups").exists()
                         and any((Path(self.tmp) / "_backups").iterdir()))
        # Vérifie qu'au moins 1 cluster détecté + mention DRY-RUN
        self.assertIn("Cluster", output)
        self.assertIn("DRY-RUN", output)


if __name__ == "__main__":
    unittest.main()
