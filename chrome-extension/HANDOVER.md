# 🐼 Hypocampus — Journal de passation

> Document de handover pour reprendre le projet froid, sans contexte préalable.
> Date : 2026-05-20.

> Note repo GitHub : ce fichier a été déplacé avec l'extension dans `chrome-extension/`.
> Les anciens chemins `D:\Hypocampus\...` décrivent l'organisation locale historique.
> Pour installer l'extension depuis ce repo, charger `chrome-extension/` dans Chrome.

---

## 1. Contexte du projet

L'utilisateur est **étudiant en médecine** (français). Il prépare l'examen EDN (Épreuves Dématérialisées Nationales). Il révise sur la plateforme **Hypocampus** (privée, payante) et possède des **PDF d'annales facultaires** à côté. Il veut un outil personnel local pour :

1. **Capturer ses erreurs sur Hypocampus** (extension Chrome qui sniff le DOM) → cahier d'erreurs.
2. **S'entraîner sur ses annales PDF** en condition d'examen (style UNESS / plateforme prépa).

**Contrainte forte (non négociable)** : l'extension ne doit générer **AUCUN signal détectable côté Hypocampus**. Pas de fetch vers `hypocampus.fr`, pas de modif DOM, juste lecture passive. C'est légal mais "suspect" pour un système anti-bot — donc on cherche à être invisible.

**Utilisateur cible** : 1 personne (lui), desktop/laptop 14"+. Pas de mobile. Pas de partage.

**Volumétrie** : ~169 captures actuellement, projection ~5000 à terme. ~10 matières × ~10 annales = ~100 annales à importer.

---

## 2. Architecture

```
D:\Hypocampus\
├── README.md                    Doc utilisateur de l'extension
├── HANDOVER.md                  Ce fichier (passation)
│
├── ── Extension Chrome MV3 ──────────────────────────────
├── manifest.json
├── background.js                Service worker (push vers localhost)
├── content.js                   Injecté dans hypocampus.fr (auto-capture)
├── extractor.js                 Parse le DOM Hypocampus (QI/DP/KFP, format detection)
├── popup.html / popup.css / popup.js   UI de l'extension
├── review.html / review.css / review.js Page review intégrée extension (fallback)
├── icons/                       Icônes 16/32/48/128
│
├── ── Site local + serveur ─────────────────────────────
├── local-site/
│   ├── start-server.bat         Double-clic pour lancer (build + serveur)
│   ├── server.py                Python http.server, port 8765, bind 127.0.0.1 only
│   ├── convert-pdf.py           Ancien script PDF → texte + prompt LLM, conservé en secours
│   │
│   ├── data/
│   │   ├── captures/            ~169 JSON, 1 fichier par question capturée
│   │   └── annales/             Annales jouables (1 JSON par annale)
│   │       ├── README.md        Workflow d'import + schéma JSON
│   │       └── _extracted/      Texte brut + rapports qualité d'import
│   │
│   └── web/                     Site React + Vite + Tailwind + shadcn/ui
│       ├── package.json
│       ├── vite.config.ts       Alias @ + proxy /api → 8765 (en dev)
│       ├── index.html           Entry Vite
│       ├── public/              Favicons générés
│       └── src/
│           ├── main.tsx         React entry
│           ├── styles/          tailwind.css + theme.css
│           ├── imports/         Logo panda
│           └── app/
│               ├── App.tsx               Router (AppShell + 4 routes)
│               ├── AppShell.tsx          Sidebar principale 88px (2 espaces)
│               ├── data-context.tsx      State global captures + computeAddedVignettes
│               ├── theme-context.tsx     Light/dark toggle
│               ├── components/ui/        47 composants shadcn (Radix)
│               └── pages/
│                   ├── list-page.tsx     /captures (cahier d'erreurs)
│                   ├── question-page.tsx /captures/q/:id (détail capture)
│                   ├── annales-list.tsx  /entrainement (liste annales)
│                   └── exam-page.tsx     /entrainement/:annaleId (mode UNESS)
│
└── archives/
    └── dom-samples/             Snapshots HTML Hypocampus (référence DOM extractor)
```

### Stack technique

- **Extension** : Manifest V3, JavaScript vanilla, pas de framework
- **Serveur** : Python `http.server` + JSON, avec `pypdf` pour l'ancien extracteur texte et `pymupdf` pour l'import local fiable des annales
- **Site web** : React 18 + Vite 6 + TailwindCSS 4 + shadcn/ui (Radix) + react-router 7 + lucide-react + date-fns
- **Build prod** : `npm run build` → `dist/` servi par le serveur Python

### Routing

| URL | Composant | Espace |
|---|---|---|
| `/` | redirect → `/captures` | — |
| `/captures` | `ListPage` | 📓 Cahier d'erreurs |
| `/captures/q/:id` | `QuestionPage` | 📓 Cahier d'erreurs |
| `/entrainement` | `AnnalesList` | 🎓 Entraînement |
| `/entrainement/:annaleId` | `ExamPage` | 🎓 Entraînement |

Anciennes routes (`/q/:id`, `/annales`, `/exam/:id`) → redirect vers nouvelles, pour pas casser les bookmarks.

---

## 3. Ce qui est fait ✅

### 📓 Espace Cahier d'erreurs (questions capturées)

**Capture (extension Chrome)** :
- Détection automatique des questions Hypocampus corrigées (QI, DP, KFP)
- Extraction : format, vignette, énoncé, options (avec selected/correct/incorrect), freeAnswers (QROC), correctionText, images base64 (canvas-based, pas de fetch réseau)
- Détection auto de la matière (regex sur termes médicaux)
- Détection auto du format (DP/KFP) par mots-clés + nombre de questions dans la série
- Format des questions séries DP/KFP : `seriesId`, `seriesPosition`, `seriesTotal`, `vignette` cumulative
- Bouton "Capturer écran visible" pour les images bloquées CORS

**Stockage (serveur Python)** :
- 1 fichier `q_<id>.json` par question dans `data/captures/`
- **Anti-doublon à 2 niveaux** :
  - `session_signature` (URL + réponses + énoncé + ...) → refus sec si exactement la même capture
  - `content_signature` (énoncé + correction + options + bonnes réponses) → si match mais session différente, ajoute une entrée à `seenAgain[]` du fichier existant (= détection de revue)
- Indexes RAM rebuildés au démarrage du serveur
- Endpoint `GET /api/dedupe-scan` pour audit rétroactif des doublons existants
- Endpoints PATCH (customTitle, chapter), DELETE (question entière + images individuelles)

**Affichage (site React)** :
- `list-page` : 169 questions groupées par matière → format → série, avec filtres (statut, format, médias, chapitre, matière), recherche full-text, tri (date, matière), 2 vues (chronologique / par matière)
- `question-page` : détail d'une question avec vignette progressive pour les DP/KFP (`computeAddedVignettes`), navigation entre questions de la même série, édition `customTitle` et `chapter`, suppression image individuelle, ajout image manuelle, **historique des revues** (`seenAgain` avec timeline)
- Mode light/dark (toggle persistant localStorage)
- Lien `📝 Annales` retiré (remplacé par sidebar principale)

### 🎓 Espace Entraînement (annales jouables)

**Workflow d'import** :
- Route `/entrainement/import` : drag & drop du PDF, puis import local via `POST /api/annales/import/local`
- Le serveur parse le PDF avec `PyMuPDF` : texte + coordonnées, images, DP/QI, questions, options, cases cochées, commentaires
- Le JSON est écrit directement dans `data/annales/<id>.json`; les images sont écrites dans `data/annales/<id>/`
- Un rapport qualité est écrit dans `data/annales/_extracted/<id>.local-report.json`
- DeepSeek n'est pas source de vérité : seulement option future pour nettoyer des blocs déjà découpés

**Stockage (serveur Python)** :
- 1 fichier `<id>.json` par annale dans `data/annales/`
- Cache RAM rebuildé au démarrage (`load_annales()`)
- 4 endpoints :
  - `GET /api/annales` : liste light triée par matière/année
  - `GET /api/annales/<id>` : annale **strippée** (pas de leak : zéro `correct: true/false`, zéro `correctionText`, zéro `expectedAnswer`, zéro `correctedImage`)
  - `GET /api/annales/<id>/img/<filename>` : sert les images (sécurisé path traversal)
  - `POST /api/annales/<id>/grade` : évalue les réponses + retourne détail complet avec corrections

**Affichage (site React)** :
- `annales-list` : cards groupées par matière (Cardio, Pneumo...), tri année descendante, bouton "Démarrer"
- `exam-page` : layout style UNESS
  - Sidebar gauche 264px : titre, chrono, barre de progression, **liste cliquable des questions** avec ✓ si répondue, regroupement visuel par DP/KFP avec en-tête de série, bouton "Soumettre"
  - Zone centrale max-w-3xl : vignette progressive (style Hypocampus avec ajouts incrémentaux highlightés), énoncé, **options en grandes cards** (lettre dans pastille, hover/selected propres), QROC en textarea
  - 2 états : `playing` (entraînement) et `submitted` (résultats)
  - Reprise session via localStorage (clé `exam_<annaleId>`)
- **Vue résultats** : note finale en grand sur gradient indigo, détail par question (vert/rouge/orange selon résultat), QROC avec comparaison ta saisie / réponse officielle, correction détaillée dépliable

**Évaluation** :
- QRU/QRM : `juste` si exactement les bonnes ET aucune mauvaise, sinon `faux`
- QROC/ZONE : `non-comptee` (l'utilisateur juge manuellement à l'œil)
- Note finale : `X / N` où N = QRU + QRM. Mention "+ Y QROC/Zone à revoir manuellement"

### 🏛 Navigation racine (AppShell)

Sidebar principale 88px à gauche extrême avec 2 espaces clairement séparés :
- 📓 **Cahier d'erreurs** (`/captures`)
- 🎓 **Entraînement** (`/entrainement`)

Logo panda cliquable en haut (= retour `/captures`).

### 🛡 Sécurité Hypocampus (audit complet effectué)

- L'extension fait **zéro fetch vers `hypocampus.fr`**
- Lecture du DOM uniquement (aucune modification, aucun injection visible côté page)
- Variables `window.__hypocampusCapture*` en isolated world (invisibles depuis main world)
- Serveur Python bind exclusivement `127.0.0.1` (jamais exposé Internet/LAN)
- `host_permissions` extension : uniquement `http://localhost/*` et `http://127.0.0.1/*`
- `chrome.tabs.captureVisibleTab` 100% local
- Images : canvas-based (pas de retéléchargement par URL)

### 🎨 Logo + branding

- Logo panda médecin (`logo-source.png` 1254×1254) dans `D:\Hypocampus\`
- 4 tailles générées pour Chrome (`icons/`)
- 5 fichiers favicons générés pour le site (`web/public/`)
- Affichage du panda dans la sidebar de la list-page (cohérence avec le logo extension)

---

## 4. Ce qui reste à faire 🔧

### Priorité 1 — Stabiliser l'import local

L'import principal doit rester déterministe : `PyMuPDF` et la mise en page PDF décident du nombre de questions, des DP/QI et des bonnes réponses. Aucun gros appel LLM ne doit reconstruire l'annale entière.

Etat attendu sur `Cardio Correction 2022 S1.pdf` :
- 57 questions
- DP1 à DP6 : 7 questions chacun
- QI : 15 questions
- 0 mismatch entre cases cochées PDF et bonnes réponses JSON
- aucun `seriesTotal` incohérent

### Priorité 2 — Vérifier l'UI exam-page sur vraies données

L'UI doit être vérifiée avec les JSON réellement importés, surtout sur les annales longues. Points à contrôler :
- Les DP/KFP se groupent bien dans la sidebar nav
- Les vignettes progressives s'affichent correctement avec leurs ajouts
- Les images PNG sont bien servies par `/api/annales/<id>/img/<filename>`
- Le chrono et la sauvegarde localStorage marchent
- La page résultat est lisible avec 30+ questions

### Priorité 3 — DeepSeek optionnel

DeepSeek peut être réintroduit seulement sur des blocs déjà découpés localement, pour nettoyer du texte ambigu. Il ne doit pas décider du découpage, des bonnes réponses ou du regroupement DP/QI.

### Hors scope explicite (à NE PAS faire en v1, sauf demande)

- ❌ Cahier d'erreurs intégré aux résultats d'annale (bouton "Ajouter au cahier")
- ❌ Historique des sessions d'examen
- ❌ `manualOverrides` pour les QROC/Zone (marquage manuel correct/faux)
- ❌ Scoring partiel EDN (0,2 / 1 etc.)
- ❌ Clic exact sur Zone avec détection coordonnées
- ❌ Statistiques avancées par chapitre / progression dans le temps
- ❌ Mode "révision uniquement les erreurs"
- ❌ Comparaison fuzzy QROC (similarité texte)
- ❌ Partage entre étudiants

L'utilisateur a explicitement validé "v1 minimaliste". Ces features sont à proposer plus tard, **après** que les fonctions de base soient utilisées en réel pendant au moins 1 semaine.

---

## 5. Points d'attention 🚨

### ⚠️ Ne pas refactorer le système captures pour réutiliser dans annales

C'est une règle posée explicitement par l'utilisateur. Le système de captures (`data-context.tsx`, `question-page.tsx`, `list-page.tsx`) fonctionne avec 169 questions stockées. **Aucun risque de régression accepté.**

Conséquence : le code de `computeAddedVignettes()` et le rendu du "Cas clinique progressif" sont **dupliqués** dans `exam-page.tsx` (et non extraits en utilitaire partagé). Total ~110 lignes dupliquées, c'est assumé.

### ⚠️ Deux mondes parallèles : captures vs annales

| | Captures | Annales |
|---|---|---|
| Source | Extension Chrome (Hypocampus DOM) | PDF + LLM externe |
| Type principal | `Question` (data-context.tsx) | `PlayQuestion` (exam-page.tsx) |
| Champ format | `format: 'QI' \| 'DP' \| 'KFP'` | `questionType: 'QRU' \| 'QRM' \| 'QROC' \| 'ZONE'` + `seriesFormat: 'DP' \| 'KFP'` |
| Options | `options[].correct, selected, incorrect` | `options[].correct` (mais strippé en mode play) |
| Réponses libres | `freeAnswers[].userAnswer/expectedAnswer` | `expectedAnswer` (string simple) |
| Stockage serveur | `data/captures/q_<id>.json` | `data/annales/<id>.json` |
| Endpoints | `/api/captures/*` | `/api/annales/*` |

Les 2 systèmes ne partagent **PAS de code, pas de types, pas d'endpoints**. C'est volontaire. Ne pas mélanger.

### ⚠️ Vignettes DP : cumulatives, pas incrémentales

Dans les JSON (captures comme annales), le champ `vignette` contient le cas clinique **cumulatif** à ce stade (vignette de Q1 + tous les ajouts intercalés jusqu'à cette question).

Côté client, `computeAddedVignettes()` / `computeSeriesVignettes()` calcule **automatiquement le diff** entre questions consécutives d'une série. Le rendu affiche la vignette de Q1 en haut + des blocs "Nouvelle information (Q2)", "Q3", etc.

**Ne jamais demander à l'utilisateur de calculer les diffs lui-même.** Le LLM externe doit produire la vignette cumulative, le client gère le reste.

### ⚠️ Anti-leak côté annales

`GET /api/annales/<id>` **doit toujours** strip ces champs avant envoi au client :
- `options[].correct`
- `expectedAnswer`
- `correctedImage`
- `correctionText`

Sinon l'utilisateur pourrait tricher en regardant F12 → Network pendant l'entraînement. La vérif est dans `annale_for_play()` (`server.py`).

Ces champs reviennent uniquement avec la réponse de `POST /api/annales/<id>/grade`.

### ⚠️ Cache navigateur

Le serveur Python envoie `Cache-Control: no-store` sur les fichiers statiques pour éviter que Chrome cache un vieux `app.js`. Si jamais ce header est retiré, l'utilisateur va voir des bugs aléatoires après rebuild → ne JAMAIS retirer ce header.

### ⚠️ Plan mode

L'utilisateur active régulièrement le plan mode (Shift+Tab). Quand il le fait :
- Ne pas faire d'edits en dehors du plan file (`C:\Users\anase\.claude\plans\met-a-de-cot-synthetic-moler.md`)
- Terminer le tour par `AskUserQuestion` (clarification) ou `ExitPlanMode` (validation)
- L'utilisateur peut rejeter le plan et donner des corrections via texte — itérer plusieurs fois si besoin

### ⚠️ Style de communication de l'utilisateur

L'utilisateur est **direct, parfois sec, parfois énervé** (perte de patience). Quand ça arrive :
- Ne pas se justifier longuement, ni rajouter de tâches qu'il n'a pas demandées
- Reconnaître l'erreur ("mea culpa") quand on a fait n'importe quoi
- Simplifier, exécuter rapidement, montrer le résultat

Il préfère **action concrète** à description longue.

### ⚠️ Fichiers Windows + encodage

- Toujours sauver en UTF-8 (Python `open(..., encoding='utf-8')`)
- Console Windows : ajouter `sys.stdout.reconfigure(encoding="utf-8", errors="replace")` au début des scripts Python pour éviter les crashs `cp1252`
- Pas de chars Unicode exotiques dans les scripts `.bat` (Windows console = cp1252)

---

## 6. Workflow utilisateur

### Setup initial

1. Charger l'extension dans Chrome : `chrome://extensions` → mode dev → "Charger l'extension non empaquetée" → sélectionner `D:\Hypocampus\`
2. Premier lancement du site : double-clic `D:\Hypocampus\local-site\start-server.bat` (fait `npm install` + `npm run build` la 1ère fois → 1-2 min) → ouvre auto `http://127.0.0.1:8765`

### Usage quotidien — Cahier d'erreurs

1. Sur Hypocampus, cliquer "Activer la session" dans le popup → l'extension capture automatiquement chaque question corrigée fausse/partielle/indéterminée
2. À tout moment : `http://127.0.0.1:8765/captures` pour réviser
3. Pour ajouter une image bloquée CORS : popup → "Capturer écran visible"
4. Pour renommer/chapitrer une question : page détail → boutons ✏️ et 📚
5. Pour supprimer : 🗑 (avec confirmation)

### Usage occasionnel — Annales

1. Lancer `D:\Hypocampus\local-site\start-server.bat`
2. Site → `/entrainement/import`
3. Déposer le PDF
4. Renseigner matière, année, session, titre, identifiant
5. Cliquer sur **Importer localement**
6. Lire le rapport qualité, puis ouvrir l'annale depuis `/entrainement`

---

## 7. Commandes utiles

```bash
# Lancer le serveur (build + démarrage)
D:\Hypocampus\local-site\start-server.bat

# Build sans démarrer
cd D:\Hypocampus\local-site\web && npm run build

# Importer une annale
D:\Hypocampus\local-site\start-server.bat
# puis ouvrir http://127.0.0.1:8765/entrainement/import

# Test serveur manuel
curl http://127.0.0.1:8765/api/health
curl http://127.0.0.1:8765/api/captures | python -c "import sys,json; print(len(json.load(sys.stdin)))"
curl http://127.0.0.1:8765/api/annales

# Voir les logs du serveur Python : ils sont dans la fenêtre noire ouverte par start-server.bat
```

---

## 8. Notes finales

- **Status global** : projet en **état utilisable** côté captures (~169 questions, fonctionnel quotidiennement). Côté annales : **infra complète mais aucune annale réelle posée**. Bloquant pour l'utilisateur tant qu'il n'aura pas converti son premier PDF.
- **Prochaine étape immédiate naturelle** : aider l'utilisateur à poser sa première annale (l'accompagner via Claude.ai si besoin), puis valider le rendu sur cardio-2024-s2.json réel.
- **Si on a du temps après** : Niveau 2 du workflow d'import (UI drag&drop) parce qu'il a 50 annales à faire.

Bonne reprise.
