"""Tests pour core.parsing (extract_pdf_text, write_annale_images).

Note : parse_qroc_source_pdf demande des fixtures PDF réelles.
parse_uness_correction_local délègue à _parse_uness_items_to_annale qui
est testée ici via des items synthétiques (pas besoin de vrais PDFs).
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.parsing import (
    write_annale_images,
    extract_pdf_text,
    _parse_uness_items_to_annale,
    _parse_moodle_correction_text,
)


class TestExtractPdfText(unittest.TestCase):

    def test_rejects_empty_bytes(self):
        with self.assertRaises(RuntimeError):
            extract_pdf_text(b"")

    def test_rejects_non_pdf_bytes(self):
        # Bytes random, pas un PDF valide
        with self.assertRaises(RuntimeError):
            extract_pdf_text(b"Not a PDF content " * 100)


class TestWriteAnnaleImages(unittest.TestCase):

    def test_empty_annale(self):
        with tempfile.TemporaryDirectory() as tmp:
            images_dir = os.path.join(tmp, "imgs")
            written = write_annale_images({"questions": []}, images_dir)
            self.assertEqual(written, 0)
            # Le dossier doit avoir été créé même si vide
            self.assertTrue(os.path.isdir(images_dir))

    def test_no_pending_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            images_dir = os.path.join(tmp, "imgs")
            annale = {"questions": [{"id": "q1", "image": None}]}
            written = write_annale_images(annale, images_dir)
            self.assertEqual(written, 0)

    def test_writes_one_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            images_dir = os.path.join(tmp, "imgs")
            annale = {
                "questions": [
                    {
                        "id": "q1",
                        "image": "q1.png",
                        "_imagesToWrite": [{"data": b"\x89PNG\r\nfake-image-data"}],
                    }
                ]
            }
            written = write_annale_images(annale, images_dir)
            self.assertEqual(written, 1)
            self.assertTrue(os.path.isfile(os.path.join(images_dir, "q1.png")))
            # Le champ _imagesToWrite doit avoir été consommé (pop)
            self.assertNotIn("_imagesToWrite", annale["questions"][0])

    def test_multiple_images_per_question_get_suffixed(self):
        with tempfile.TemporaryDirectory() as tmp:
            images_dir = os.path.join(tmp, "imgs")
            annale = {
                "questions": [
                    {
                        "id": "q1",
                        "image": "q1.png",
                        "_imagesToWrite": [
                            {"data": b"\x89PNG\r\nimage1"},
                            {"data": b"\x89PNG\r\nimage2"},
                        ],
                    }
                ]
            }
            written = write_annale_images(annale, images_dir)
            self.assertEqual(written, 2)
            files = sorted(os.listdir(images_dir))
            self.assertIn("q1.png", files)
            self.assertIn("q1-2.png", files)


# ──────────────────────────────────────────────────────────────────
# Tests pour _parse_uness_items_to_annale — détection vignette implicite
# ──────────────────────────────────────────────────────────────────


def _text_item(text, page=1, y0=0.0, lines=None):
    """Crée un item texte minimal pour _parse_uness_items_to_annale."""
    if lines is None:
        lines = [text]
    return {
        "kind": "text",
        "page": page,
        "x0": 0.0,
        "y0": float(y0),
        "x1": 500.0,
        "y1": float(y0) + 10.0,
        "text": text,
        "lines": lines,
        "blockIndex": 0,
    }


def _marker_item(number, kind="QRM", page=1, y0=0.0):
    """Crée un marqueur 'Question N : Question à réponses ...' attendu."""
    if kind == "QRU":
        suffix = "unique"
    elif kind == "QROC":
        suffix = "ouverte et courte"
    else:
        suffix = "multiples"
    text = f"Question {number} : Question à réponses {suffix}"
    return _text_item(text, page=page, y0=y0)


def _option_item(letter, correct, label, page=1, y0=0.0):
    """Crée une option A-E sous la forme attendue par parse_option
    (3+ lignes : lettre, case cochée ou non, libellé)."""
    case = "☑" if correct else "■"
    # Cas où la case n'est PAS cochée : symbole ■ (pas ☑) reste détecté comme option
    # par le parser, qui marque correct=False. Pour rester proche du PDF UNESS,
    # on utilise ☑ pour vrai et ■ pour faux.
    lines = [letter, case, label]
    text = "\n".join(lines)
    return {
        "kind": "text",
        "page": page,
        "x0": 0.0,
        "y0": float(y0),
        "x1": 500.0,
        "y1": float(y0) + 30.0,
        "text": text,
        "lines": lines,
        "blockIndex": 0,
    }


def _build_basic_question_items(number, qtype="QRM", text="Énoncé", y_start=0.0, page=1):
    """Construit les items pour une question minimale avec 2 options et une
    section correction (pour satisfaire les checks de _parse_uness_items_to_annale).

    Retourne la liste d'items et le y0 final.
    """
    y = y_start
    out = [_marker_item(number, kind=qtype, page=page, y0=y)]
    y += 20
    out.append(_text_item(text, page=page, y0=y))
    y += 20
    out.append(_option_item("A", True, "Bonne réponse", page=page, y0=y))
    y += 30
    out.append(_option_item("B", False, "Mauvaise réponse", page=page, y0=y))
    y += 30
    out.append(_text_item("Commentaire de correction de la question", page=page, y0=y))
    y += 20
    out.append(_text_item("Correction détaillée OK.", page=page, y0=y))
    y += 30
    return out, y


_META = {
    "id": "annale-test-2024",
    "title": "Annale Test 2024",
    "subject": "test",
    "year": 2024,
    "session": None,
}


class TestParseUnessItemsExplicitSeriesUnchanged(unittest.TestCase):
    """Test 1 — Un PDF avec header DP explicite ne doit PAS déclencher
    de série implicite (comportement actuel inchangé)."""

    def test_explicit_dp_header_no_implicit_series(self):
        items = []
        y = 0.0
        # Header DP explicite + vignette
        items.append(_text_item("DP 1", y0=y)); y += 20
        items.append(_text_item(
            "Madame Léa, 67 ans, consulte pour des douleurs thoraciques "
            "persistantes depuis 3 jours. Elle est admise aux urgences pour "
            "une suspicion de syndrome coronarien aigu. Antécédents : HTA, "
            "tabagisme actif, diabète de type 2 mal équilibré.",
            y0=y,
        )); y += 60
        # 5 questions QRM minimales (besoin de >=5 markers pour passer le check)
        for n in (1, 2, 3, 4, 5):
            q_items, y = _build_basic_question_items(n, y_start=y)
            # Q1, Q2 mentionnent Madame Léa pour rester cohérents
            if n in (1, 2):
                q_items[1] = _text_item(
                    f"Question {n} concernant Madame Léa.", y0=q_items[1]["y0"]
                )
            items.extend(q_items)

        annale, report, _raw = _parse_uness_items_to_annale(
            items, _META, page_count=1, raw_text="dummy"
        )

        # Aucune série n'a pour id un préfixe 'implicit-'
        implicit_series = [
            q for q in annale["questions"]
            if q.get("seriesId") and str(q.get("seriesId")).startswith("implicit-")
        ]
        self.assertEqual(implicit_series, [], "Pas de série implicite attendue")
        # Aucune question n'a de warning implicit-series-detected
        for q in annale["questions"]:
            codes = [w.get("code") for w in q.get("warnings") or []]
            self.assertNotIn("implicit-series-detected", codes)
        # En revanche on doit avoir une série DP explicite (dp1)
        self.assertTrue(any(q.get("seriesId") == "dp1" for q in annale["questions"]))


class TestParseUnessItemsImplicitSingleSeries(unittest.TestCase):
    """Test 2 — PDF text avec 'Madame X présente...' + Q1 mentionnant
    'Madame X' → série implicite créée, vignette assignée à Q1, warning."""

    def test_implicit_series_detected_basic(self):
        items = []
        y = 0.0
        # Paragraphe vignette substantiel SANS header DP
        items.append(_text_item(
            "Madame Léa Dupont, 67 ans, sans antécédent particulier, consulte "
            "ce matin pour des douleurs thoraciques rétrosternales irradiant "
            "vers le bras gauche, apparues il y a deux heures. Elle est "
            "hospitalisée en USIC pour suspicion de SCA ST+.",
            y0=y,
        ))
        y += 100
        # 5 questions, Q1 et Q2 référencent Madame Léa
        for n in (1, 2, 3, 4, 5):
            q_items, y = _build_basic_question_items(n, y_start=y)
            if n == 1:
                q_items[1] = _text_item(
                    "Que proposez-vous chez Madame Léa en première intention ?",
                    y0=q_items[1]["y0"],
                )
            elif n == 2:
                q_items[1] = _text_item(
                    "Concernant cette patiente, quelle est la stratégie ?",
                    y0=q_items[1]["y0"],
                )
            items.extend(q_items)

        annale, report, _raw = _parse_uness_items_to_annale(
            items, _META, page_count=1, raw_text="dummy"
        )

        q1 = annale["questions"][0]
        q2 = annale["questions"][1]
        self.assertTrue(
            str(q1.get("seriesId") or "").startswith("implicit-"),
            f"Q1 seriesId doit commencer par 'implicit-', got {q1.get('seriesId')!r}",
        )
        self.assertEqual(q1.get("seriesFormat"), "DP")
        # La vignette doit être attachée à Q1
        self.assertIsNotNone(q1.get("vignette"))
        self.assertIn("Madame Léa", q1.get("vignette") or "")
        # Position 1, total >= 2 (au moins Q1+Q2)
        self.assertEqual(q1.get("seriesPosition"), 1)
        self.assertGreaterEqual(q1.get("seriesTotal") or 0, 2)
        # Warning implicit-series-detected présent
        codes_q1 = [w.get("code") for w in q1.get("warnings") or []]
        self.assertIn("implicit-series-detected", codes_q1)
        # Q2 partage la même série
        self.assertEqual(q2.get("seriesId"), q1.get("seriesId"))
        # Q2 n'a pas la vignette (seule Q1 la porte)
        self.assertIsNone(q2.get("vignette"))


class TestParseUnessItemsImplicitSeriesEndsOnNoReference(unittest.TestCase):
    """Test 3 — Monsieur Y consulte... + Q1 + Q2 mentionnant Monsieur Y
    puis Q3 sans référence → série implicite Q1+Q2, Q3 hors série."""

    def test_implicit_series_stops_when_no_reference(self):
        items = []
        y = 0.0
        items.append(_text_item(
            "Monsieur Yannick Martin, 54 ans, tabagique sevré, consulte aux "
            "urgences pour une dyspnée d'apparition brutale ce matin. "
            "Il est admis en pneumologie pour bilan étiologique. Antécédents "
            "personnels : BPCO modérée, HTA traitée.",
            y0=y,
        ))
        y += 100
        for n in (1, 2, 3, 4, 5):
            q_items, y = _build_basic_question_items(n, y_start=y)
            if n == 1:
                q_items[1] = _text_item(
                    "Que proposez-vous chez Monsieur Martin en urgence ?",
                    y0=q_items[1]["y0"],
                )
            elif n == 2:
                q_items[1] = _text_item(
                    "Chez ce patient, quelle imagerie demandez-vous ?",
                    y0=q_items[1]["y0"],
                )
            # Q3 = QCM générique, sans référence nominale
            elif n == 3:
                q_items[1] = _text_item(
                    "Quels sont les critères de gravité d'une embolie pulmonaire ?",
                    y0=q_items[1]["y0"],
                )
            items.extend(q_items)

        annale, report, _raw = _parse_uness_items_to_annale(
            items, _META, page_count=1, raw_text="dummy"
        )

        q1 = annale["questions"][0]
        q2 = annale["questions"][1]
        q3 = annale["questions"][2]
        # Q1 + Q2 dans la série implicite
        self.assertTrue(str(q1.get("seriesId") or "").startswith("implicit-"))
        self.assertEqual(q2.get("seriesId"), q1.get("seriesId"))
        self.assertEqual(q1.get("seriesTotal"), 2)
        self.assertEqual(q1.get("seriesPosition"), 1)
        self.assertEqual(q2.get("seriesPosition"), 2)
        # Q3 hors série
        self.assertIsNone(q3.get("seriesId"))
        self.assertIsNone(q3.get("vignette"))
        # Warning sur Q1 et Q2 mais pas Q3
        self.assertIn(
            "implicit-series-detected",
            [w.get("code") for w in q1.get("warnings") or []],
        )
        self.assertIn(
            "implicit-series-detected",
            [w.get("code") for w in q2.get("warnings") or []],
        )
        self.assertNotIn(
            "implicit-series-detected",
            [w.get("code") for w in q3.get("warnings") or []],
        )


class TestParseUnessItemsImplicitSeriesShortParagraphRejected(unittest.TestCase):
    """Test 4 — Paragraphe court (<150 chars) avant Q1 → pas de série implicite."""

    def test_short_paragraph_no_implicit_series(self):
        items = []
        y = 0.0
        # Paragraphe très court mais avec patient marker + verbe
        items.append(_text_item("Mme L. consulte.", y0=y))
        y += 20
        for n in (1, 2, 3, 4, 5):
            q_items, y = _build_basic_question_items(n, y_start=y)
            # Même si Q1 mentionne Madame L., le paragraphe est trop court
            if n == 1:
                q_items[1] = _text_item(
                    "Que proposez-vous chez Madame L. ?", y0=q_items[1]["y0"]
                )
            items.extend(q_items)

        annale, report, _raw = _parse_uness_items_to_annale(
            items, _META, page_count=1, raw_text="dummy"
        )

        for q in annale["questions"]:
            self.assertFalse(
                str(q.get("seriesId") or "").startswith("implicit-"),
                f"Aucune série implicite ne doit être créée pour un paragraphe court",
            )
            codes = [w.get("code") for w in q.get("warnings") or []]
            self.assertNotIn("implicit-series-detected", codes)


class TestParseUnessItemsNoPatientMarkerNoImplicit(unittest.TestCase):
    """Test 5 — PDF text sans patient marker + Q1 QCM classique → pas de série."""

    def test_no_patient_marker_no_implicit_series(self):
        items = []
        y = 0.0
        # Texte introductif générique (en-tête de section), pas de marker patient
        items.append(_text_item(
            "Le présent document regroupe les questions du concours blanc 2024. "
            "Veuillez répondre à chaque question dans le temps imparti. La notation "
            "suit le barème national. Bonne chance à tous les candidats.",
            y0=y,
        ))
        y += 80
        for n in (1, 2, 3, 4, 5):
            q_items, y = _build_basic_question_items(
                n, y_start=y, text=f"Quelle est la réponse à la question {n} ?"
            )
            items.extend(q_items)

        annale, report, _raw = _parse_uness_items_to_annale(
            items, _META, page_count=1, raw_text="dummy"
        )

        for q in annale["questions"]:
            self.assertIsNone(q.get("seriesId"))
            self.assertIsNone(q.get("vignette"))
            codes = [w.get("code") for w in q.get("warnings") or []]
            self.assertNotIn("implicit-series-detected", codes)


class TestParseMoodleCorrectionText(unittest.TestCase):

    def test_moodle_export_detects_implicit_and_colonless_series(self):
        raw_text = """
        DP1:
        Mme Michel, 73 ans, consulte pour une douleur de jambe a la marche.

        Question 1 Correct
        Note de 1,00 sur 1,00
        Texte de la question
        Quel signe recherchez-vous ?
        Question 1 Reponse
        a. abolition des pouls
        b. fievre
        Feedback
        La reponse correcte est : abolition des pouls

        Question 2 Correct
        Texte de la question
        Quel traitement proposez-vous ?
        Question 2 Reponse
        a. aspirine
        b. antibiotique
        Feedback
        La reponse correcte est : aspirine
        Vous etes remplacant en cabinet de medecine generale. Monsieur D., 39 ans,
        sans antecedent, consulte pour une dyspnee rapidement progressive depuis
        quelques jours. Il ne fume pas et n'a pas eu de syndrome infectieux.

        Question 1 Incorrect
        Texte de la question
        Quelles sont les hypotheses principales ?
        Question 1 Reponse
        a. embolie pulmonaire
        b. dermatose
        Feedback
        La reponse correcte est : embolie pulmonaire

        Question 2 Correct
        Texte de la question
        Quel examen demandez-vous ?
        Question 2 Reponse
        a. echocardiographie
        b. frottis
        Feedback
        La reponse correcte est : echocardiographie

        DP 4 Mme V., 62 ans, consulte apres decouverte de chiffres tensionnels
        eleves chez son pharmacien.

        Question 1 Partiellement correct
        Texte de la question
        Quelles affirmations sur l'hypertension sont exactes ?
        Question 1 Reponse
        a. facteur de risque vasculaire
        b. maladie toujours symptomatique
        Feedback
        La reponse correcte est : facteur de risque vasculaire

        KFP2 Vous recevez aux urgences un patient de 72 ans pour palpitations.
        Il presente une hypertension arterielle et un diabete de type 2.

        Question 1 Incorrect
        Texte de la question
        Quel est le rythme observe ?
        Reponse :
        Feedback
        La reponse correcte est : fibrillation atriale
        """

        annale, report, _raw = _parse_moodle_correction_text(
            raw_text,
            {
                "id": "cardio-2025-s1-test",
                "title": "Cardio 2025 S1 Test",
                "subject": "Cardiologie",
                "year": 2025,
                "session": "S1",
            },
            page_count=1,
        )

        self.assertEqual(report["profile"], "moodle-hypocampus-correction")
        self.assertEqual(len(annale["questions"]), 6)
        self.assertEqual(annale["questions"][0].get("seriesId"), "dp1")
        self.assertEqual(annale["questions"][0].get("vignette").split(",")[0], "Mme Michel")

        q2 = annale["questions"][1]
        q3 = annale["questions"][2]
        self.assertNotIn("Vous etes remplacant", q2.get("correctionText") or "")
        self.assertEqual(q3.get("seriesFormat"), "DP")
        self.assertTrue(str(q3.get("seriesId") or "").startswith("moodle-dp-cardio-2025-s1-test-"))
        self.assertTrue((q3.get("vignette") or "").startswith("Vous etes remplacant"))

        q5 = annale["questions"][4]
        self.assertEqual(q5.get("seriesId"), "dp4")
        self.assertIn("Mme V", q5.get("vignette") or "")

        q6 = annale["questions"][5]
        self.assertEqual(q6.get("seriesId"), "kfp2")
        self.assertEqual(q6.get("seriesFormat"), "KFP")
        self.assertIn("patient de 72 ans", q6.get("vignette") or "")


if __name__ == "__main__":
    unittest.main()
