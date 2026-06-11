# -*- coding: utf-8 -*-
"""
Workflow d'import d'une annale depuis un PDF vers le format JSON jouable.

Usage :
  python convert-pdf.py "D:\\chemin\\vers\\annale.pdf" cardio-2024-s2 Cardiologie 2024

Étapes :
  1. Extrait le texte du PDF → data/annales/_extracted/<id>.txt
  2. Affiche le prompt LLM prêt à copier-coller dans Claude/ChatGPT/Gemini
  3. Tu colles ton texte + le prompt dans le LLM
  4. Tu récupères le JSON et tu le poses dans data/annales/<id>.json
  5. Au prochain démarrage de start-server.bat, l'annale apparaît dans /annales

Dépendance : pip install pypdf  (déjà installé)
"""

import os
import sys
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    print("ERREUR : pip install pypdf manquant. Exécute : pip install pypdf")
    sys.exit(1)


ROOT = Path(__file__).resolve().parent
ANNALES_DIR = ROOT / "data" / "annales"
EXTRACTED_DIR = ANNALES_DIR / "_extracted"


PROMPT_TEMPLATE = """Tu es un parseur d'annales médicales. À partir du texte ci-dessous (extrait d'un PDF
d'annale type EDN/UNESS), produis un fichier JSON conforme au schéma fourni.

RÈGLES STRICTES :
- Ne reformule jamais le texte des énoncés, options ou corrections : copie MOT POUR MOT.
- Identifie le type de chaque question parmi : QRU (1 seule bonne réponse), QRM (plusieurs
  bonnes réponses), QROC (réponse libre courte), ZONE (image cliquable, réponse par texte).
- Les bonnes réponses sont marquées par ☑ dans le PDF (cases cochées). Les autres options
  sont marquées par ■ (cases vides). Pour chaque option, mets correct: true si ☑, false sinon.
- Pour les Dossiers Progressifs (DP) et KFP : les questions consécutives partagent un même
  seriesId (ex: "dp-1", "kfp-2"). Mets seriesFormat: "DP" ou "KFP" selon le PDF.
  La vignette de chaque question contient le cas clinique CUMULATIF visible à ce stade
  (= vignette de Q1 + tous les ajouts intercalés jusqu'à cette question).
- Les questions isolées (QI) n'ont pas de seriesId, seriesPosition, vignette, etc.
- Pour les images : indique le nom de fichier (ex: "q5.png"). L'utilisateur posera l'image
  lui-même dans le sous-dossier. Si pas d'image, mets null.
- Ne pas inventer de question : si tu hésites, omets-la.

SCHÉMA JSON ATTENDU :

{
  "id": "<ID_ANNALE>",
  "title": "<TITRE>",
  "subject": "<MATIERE>",
  "year": <ANNEE>,
  "questions": [
    {
      "id": "q1",
      "questionType": "QRU" | "QRM" | "QROC" | "ZONE",
      "text": "<énoncé exact>",
      "image": null,

      // QRU/QRM uniquement :
      "options": [
        { "id": "A", "text": "<texte option>", "correct": true|false },
        { "id": "B", "text": "<texte option>", "correct": true|false },
        ...
      ],

      // QROC uniquement :
      "expectedAnswer": "<réponse officielle>",

      // ZONE uniquement :
      "correctedImage": "<nom-fichier-corrige.png ou null>",

      // Toujours :
      "correctionText": "<commentaire de correction copié mot pour mot>",

      // Si dans un DP ou KFP :
      "seriesId": "<dp-1 ou kfp-2>",
      "seriesFormat": "DP" | "KFP",
      "seriesPosition": 1,
      "seriesTotal": <nombre total de questions de cette série>,
      "vignette": "<cas clinique CUMULATIF visible à ce stade>",
      "customTitle": "<titre du dossier, optionnel>"
    }
  ]
}

Ne renvoie QUE le JSON, sans texte autour, sans bloc Markdown.

VOICI LE TEXTE DE L'ANNALE :

<<COLLE_LE_TEXTE_DU_FICHIER_TXT_ICI>>
"""


def main():
    if len(sys.argv) < 5:
        print("Usage :")
        print('  python convert-pdf.py "<chemin-vers-pdf>" <id> <subject> <year>')
        print()
        print("Exemple :")
        print('  python convert-pdf.py "D:\\Document\\Annales S2\\Cardio\\Cardio Correction 2024 S2.pdf" cardio-2024-s2 Cardiologie 2024')
        sys.exit(1)

    pdf_path = Path(sys.argv[1])
    annale_id = sys.argv[2]
    subject = sys.argv[3]
    year = sys.argv[4]

    if not pdf_path.is_file():
        print(f"ERREUR : fichier introuvable : {pdf_path}")
        sys.exit(1)

    # Étape 1 : extrait le texte
    EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)
    txt_path = EXTRACTED_DIR / f"{annale_id}.txt"

    print(f"[1/3] Lecture du PDF : {pdf_path.name}")
    reader = PdfReader(str(pdf_path))
    print(f"      {len(reader.pages)} pages")

    with open(txt_path, "w", encoding="utf-8") as f:
        for i, page in enumerate(reader.pages):
            f.write(f"\n========== PAGE {i+1} / {len(reader.pages)} ==========\n")
            f.write(page.extract_text())
            f.write("\n")

    print(f"      Texte extrait : {txt_path}")
    print(f"      Taille : {txt_path.stat().st_size} bytes")

    # Étape 2 : génère le prompt prêt
    prompt_path = EXTRACTED_DIR / f"{annale_id}.prompt.txt"

    title = f"{subject} {year}"
    rendered_prompt = PROMPT_TEMPLATE.replace("<ID_ANNALE>", annale_id) \
        .replace("<TITRE>", title) \
        .replace("<MATIERE>", subject) \
        .replace("<ANNEE>", str(year))

    # On insère directement le contenu du txt dans le prompt (LLM peut tout avaler d'un coup)
    with open(txt_path, "r", encoding="utf-8") as f:
        txt_content = f.read()
    full_prompt = rendered_prompt.replace("<<COLLE_LE_TEXTE_DU_FICHIER_TXT_ICI>>", txt_content)

    with open(prompt_path, "w", encoding="utf-8") as f:
        f.write(full_prompt)

    print(f"[2/3] Prompt LLM généré (prêt à copier-coller) :")
    print(f"      {prompt_path}")
    print(f"      Taille : {prompt_path.stat().st_size} bytes")
    print()
    print("[3/3] Étapes manuelles :")
    print(f"      a) Ouvre {prompt_path} dans un éditeur")
    print(f"      b) Sélectionne tout (Ctrl+A) + Copie (Ctrl+C)")
    print(f"      c) Colle dans Claude / ChatGPT / Gemini (modèle costaud : Opus, GPT-4, Gemini Pro)")
    print(f"      d) Récupère le JSON retourné")
    print(f"      e) Pose-le dans : {ANNALES_DIR / (annale_id + '.json')}")
    print(f"      f) Relance start-server.bat → l'annale apparaît sur /annales")
    print()
    print("Note : si des images sont mentionnées dans le JSON, pose-les dans :")
    print(f"      {ANNALES_DIR / annale_id}/")


if __name__ == "__main__":
    # Force UTF-8 sur stdout pour Windows console
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
