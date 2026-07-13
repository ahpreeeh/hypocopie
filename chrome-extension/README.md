# Hypocampus

Système personnel de capture et de révision des questions Hypocampus corrigées.

> Note repo GitHub : dans ce dépôt, l'extension Chrome est rangée dans `chrome-extension/`.
> Pour l'installer, charger ce dossier précis dans `chrome://extensions/`, pas la racine du repo.

Deux composants :

1. **Extension Chrome Manifest V3** (racine du dossier) → capture les questions depuis Hypocampus
2. **Site local + serveur Python** (`local-site/`) → stocke et permet de réviser les captures, avec UI moderne React

## Structure du dossier

```
D:\Hypocampus\
├── README.md
│
├── ── Extension Chrome ──────────────────────
│
├── manifest.json           # config MV3
├── background.js           # service worker + push vers serveur local
├── content.js              # session auto sur l'onglet Hypocampus
├── extractor.js            # parse le DOM Hypocampus (QI / DP / KFP / QROC)
├── popup.html / popup.css / popup.js   # UI extension
├── review.html / review.css / review.js # page de révision intégrée à l'extension
│
├── ── Site local ────────────────────────────
│
├── local-site/
│   ├── server.py                # serveur Python http.server (127.0.0.1:8765)
│   ├── start-server.bat         # double-clic : build + lance le serveur + ouvre navigateur
│   ├── data/captures/           # 1 fichier JSON par question (source de vérité)
│   └── web/                     # site React + Vite + Tailwind + shadcn/ui
│       ├── src/                 # code source du site
│       ├── dist/                # build prod (servi par server.py)
│       └── node_modules/        # dépendances npm
│
└── archives/
    └── dom-samples/    # snapshots HTML Hypocampus utilisés au début pour
                        # écrire l'extracteur. À garder pour debug futur
                        # si Hypocampus change son DOM.
```

## Utilisation rapide

### Extension Chrome (capture)

Charge le dossier `D:\Hypocampus\` dans `chrome://extensions/` en mode développeur.

Boutons du popup :

- **Capturer cette question** : sauve la question visible si elle est fausse, partielle ou indéterminée
- **Activer / Désactiver la session** : capture automatique sur changement de DOM
- **Capturer l'écran visible** : screenshot local attaché à la dernière question (utile si une image n'a pas été récupérée à cause de CORS)
- **Ouvrir mon site** : ouvre le site local de révision
- **Migrer vers disque** : transfère tout `chrome.storage.local` vers `local-site/data/captures/`
- **Voir les captures (extension)** : page de révision intégrée à l'extension (fallback si serveur local éteint)

### Site local (révision)

Double-clic sur `local-site/start-server.bat`. Au premier lancement :
1. `npm install` (1-2 min)
2. `npm run build` (10-20 s)
3. Lance le serveur Python sur `http://127.0.0.1:8765`
4. Ouvre automatiquement le navigateur

Aux lancements suivants : direct.

### Import annales local

Dans le site local, ouvre `http://127.0.0.1:8765/entrainement/import`.

Workflow :

1. Deposer le PDF de l'annale.
2. Renseigner matiere, annee, session, titre et identifiant.
3. Cliquer sur **Importer localement**.

Le serveur local lit le PDF avec `PyMuPDF`, extrait le texte avec coordonnees, detecte localement les DP/QI/questions/options/cases cochees/commentaires, extrait les images et ecrit l'annale dans `local-site/data/annales/<id>.json`.

L'import principal ne fait aucun appel API. DeepSeek reste seulement une option future pour nettoyer un bloc deja decoupe, sans decider du nombre de questions ni des bonnes reponses.

Le serveur refuse les PDFs hors profil au lieu de generer un JSON douteux. Les corrections vides restent autorisees, mais elles sont signalees dans le rapport d'import.

## Données stockées par question

Chaque capture est un fichier `data/captures/q_<id>.json` contenant :

- `id`, `format` (QI/DP/KFP), `subject`, `chapter` (éditable), `customTitle` (éditable)
- `seriesId`, `seriesPosition`, `seriesTotal` (pour les DP/KFP progressifs)
- `vignette` (cas clinique) — cumulative pour les DP, l'UI calcule les ajouts incrémentaux
- `questionText`, `correctionText`
- `options[]` (QCM) avec `text`, `correct`, `selected`
- `freeAnswers[]` (QROC/QRP) avec `userAnswer`, `expectedAnswer`
- `selectedAnswers[]`, `correctAnswers[]`
- `images[]` : tentative d'intégration en `data:image/...;base64,...` depuis l'image déjà affichée dans le navigateur. Si Chrome bloque (CORS), l'entrée est `{ dataUrl: null, dataUrlStatus: "canvas-blocked" }` et l'utilisateur peut ajouter manuellement une image
- `screenshots[]` : captures écran manuelles attachées
- `status` (wrong / partial / unknown), `score`, `capturedAt`, `url`
- `seenAgain[]` : historique automatique des revues (date, URL, statut, réponses cochées) — permet de suivre la progression sur les questions récurrentes

## Anti-doublon et détection de revue

Géré côté serveur Python via deux signatures hashées :

- **Signature de session** (URL + réponses cochées + énoncé + ...) : si match → la capture est refusée (vrai doublon)
- **Signature de contenu** (énoncé + correction + options + bonnes réponses) : si match mais session différente → la nouvelle capture **n'est pas créée** comme fichier séparé, mais ajoutée à `seenAgain[]` de la question d'origine. Tu vois alors ta progression sur cette question au fil du temps.

Endpoint `GET /api/dedupe-scan` retourne les groupes de doublons existants sur disque (utile pour fusion rétroactive).

## Sécurité Hypocampus

- L'extension ne fait **aucune requête supplémentaire** vers `hypocampus.fr`. Elle lit uniquement le DOM visible.
- Aucun appel à l'API Hypocampus, aucun re-téléchargement d'image.
- Le serveur Python bind exclusivement sur `127.0.0.1` (inaccessible depuis Internet ou LAN).
- Les `host_permissions` de l'extension sont limitées à `localhost`.

## Limites

- L'extracteur ne lit que ce qui est visible dans le DOM (pas d'API).
- Les images protégées par CORS doivent être ajoutées manuellement via le bouton screenshot ou l'upload depuis le site local.
- Le format `DP_or_KFP` est utilisé quand l'heuristique de l'extracteur ne peut pas trancher entre DP et KFP (pas de mot-clé explicite et pas assez de questions dans la série pour décider).
