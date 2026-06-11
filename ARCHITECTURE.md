# ARCHITECTURE — Backend & Data Layer

> Document technique de référence pour `local-site/` (serveur Python + UI React + stockage JSON-on-disk).
> Lié à `D:\Hypocampus\HANDOVER.md` (contexte produit) et `D:\Hypocampus\README.md` (vue d'ensemble).
> Dernière revue : 2026-05-22.

## Avancement chantier (mai 2026)

### ✅ Phase 0 — Stabilisation urgente — COMPLÈTE

| Item | Implémentation |
|---|---|
| INDEX_LOCK sur `_session_index`, `_content_index` | `threading.Lock()` + helpers `lookup_session_index`, `lookup_content_index`, `set_session_index` |
| Atomic writes captures + sessions + screenshots | Toutes les écritures passent par `write_json_file()` (`.tmp` + `os.replace()`) |
| Backup automatique | `POST /api/admin/backup` + `GET /api/admin/backups` + `DELETE /api/admin/backups/<name>`. Auto-trigger 1×/jour côté UI (AppShell.tsx). Bouton manuel dans la sidebar. Rétention 30 derniers. |
| Audit log | `data/_audit.jsonl` append-only, thread-safe. Trace : `publish_annale`, `import_local_annale`, `rename_annale`, `delete_exam_session`, `delete_capture`, `backup_created`, `delete_backup`. |

### ✅ Phase 1 — Modularisation server.py — COMPLÈTE (modules + handlers + tests)

**Bilan structure finale** :

```
local-site/
├── server.py            (2857 lignes — dispatcher + logique encore inline pour QROC complexe)
├── core/                (1400 lignes — 6 modules zéro-dépendance)
│   ├── storage.py       — IDs, atomic I/O, AuditLog, BackupManager
│   ├── deepseek.py      — Client API + retry 429 + sémaphore
│   ├── text_utils.py    — fold_ascii, clean_pdf_text, severity helpers
│   ├── qroc_blocks.py   — Validation blocs source QROC
│   ├── parsing.py       — Parser UNESS + QROC + write_annale_images
│   └── models.py        — Dataclasses (Option, Question, ExamSessionPayload, etc.)
├── handlers/            (440 lignes — handlers HTTP par domaine)
│   ├── admin.py         — 3 endpoints branchés (backup CRUD)
│   ├── annales.py       — 1 endpoint branché (liste)
│   ├── captures.py      — 3 endpoints branchés (list, detail, delete)
│   ├── exam_sessions.py — 3 endpoints branchés (list, detail, delete)
│   └── qroc.py          — squelette (4 fonctions définies)
└── tests/               (435 lignes — 53 tests)
    ├── test_storage.py  — SAFE_ID, safe_filename, safe_slug, atomic I/O, AuditLog, BackupManager
    ├── test_text_utils.py — fold_ascii, clean_pdf_text, severity helpers
    └── test_models.py   — Option, Question, ExamSessionPayload, LocalImportMeta, AnnalePatchPayload
```

**Validation** :
- ✅ **53 tests unitaires passent** (`python -m unittest discover tests`)
- ✅ **Zéro régression** sur les endpoints branchés (32 annales, 190 captures, 1 session, 3 drafts, 3 backups)
- ✅ **1 bug détecté et corrigé** grâce aux tests : `ExamSessionPayload.from_dict({"answers": []})` acceptait silencieusement (le `or {}` fallthrough). Désormais : lève ValueError.

### Détail des modules core/ extraits

| Module | Lignes | Contenu |
|---|---|---|
| ✅ `core/storage.py` | 218 | `SAFE_ID`, `safe_filename`, `safe_slug`, `utc_now_iso`, `read_json_file`/`write_json_file` (atomic), `AuditLog` (singleton), `BackupManager` |
| ✅ `core/deepseek.py` | 121 | `DEEPSEEK_CHAT_URL`, `DEEPSEEK_MODELS`, `DEEPSEEK_RETRY_DELAYS`, `DEEPSEEK_CALL_SEMAPHORE`, `parse_json_object`, `call_deepseek_json` (retry + sémaphore) |
| ✅ `core/text_utils.py` | 98 | `fold_ascii`, `clean_pdf_text`, `int_or_none`, `normalize_question_id`, `qroc_source_warning`, `is_blocking_severity` |
| ✅ `core/qroc_blocks.py` | 107 | `source_block_stats`, `validate_source_block`, `is_qroc_block_start` |
| ✅ `core/parsing.py` | 593 | `extract_pdf_text` (pypdf), `parse_qroc_source_pdf` + `write_annale_images` (paramétrés par `images_dir`), `parse_uness_correction_local` complet (avec 12 helpers nested) |
| ✅ `core/models.py` | 258 | Dataclasses standard Python : `Option`, `Question`, `AnnaleMeta`, `ExamSessionPayload`, `LocalImportMeta`, `AnnalePatchPayload`. Helpers de validation (`_require_str`, `_optional_int`). **Choix : `dataclass` au lieu de Pydantic** pour rester zéro-dépendance externe (Pydantic non installé sur la machine cible, +5 MB de deps évités). |

**Bilan chiffré final** :
- `server.py` : 3432 → 2895 lignes (**-537 lignes, -15.6%**)
- Code extrait en modules `core/` : **1401 lignes** (incluant docstrings)
- Total avant extraction : 3432 lignes monolithe
- Total après extraction : 2895 + 1401 = 4296 lignes (sur 7 fichiers vs 1)
- L'augmentation (+864) vient principalement des **docstrings nouvelles** ajoutées à chaque module pour la lisibilité (chaque module fait ~50 lignes de doc)
- 0 régression : tous les endpoints continuent de répondre (annales=32, drafts=3, captures=190)

### 🟡 Phase 1 — Étapes optionnelles à poursuivre

| Item | État | Note |
|---|---|---|
| Migration complète des endpoints QROC dans `handlers/qroc.py` | Squelette créé, 4 fonctions définies | Les endpoints `extract/generate/cancel/publish/patch` dépendent de `QROC_JOB_QUEUE`, `run_qroc_generation_job`, `normalize_source_blocks_for_patch` — coeur applicatif encore dans server.py. Migration safe = au fur et à mesure que les tests E2E sont écrits sur les flux QROC. |
| Branchement systématique de `core.models` dans les endpoints | Partiel | Les payloads `ExamSessionPayload`, `LocalImportMeta`, `AnnalePatchPayload` sont définis et importés mais pas encore utilisés à 100% pour valider les inputs des handlers. À faire en suivant le pattern : `payload = ExamSessionPayload.from_dict(raw)` avant les call-sites. |
| Tests sur parsing PDF (parse_uness_correction_local) | Reporté | Demande des fixtures PDF (3-5 PDFs UNESS de référence + résultats attendus). Permet de valider non-régression avant tout refactor du parser. |

### ⏸️ Phases 2 & 3 — non démarrées (conditionnelles)

- **Phase 2 (SQLite)** : ne pas faire tant que les signaux déclencheurs §9 ne sont pas observés (>50 sessions/mois + besoin de stats agrégées, ou >200 annales, ou feature spaced repetition envisagée)
- **Phase 3 (FastAPI)** : à éviter sauf déploiement cloud / multi-user

---

## 1. Vue d'ensemble

```
                                    +-------------------+
                                    |  Extension MV3    |
                                    |  Chrome popup     |
                                    |  content+extractor|
                                    +--------+----------+
                                             |
                                             | POST /api/captures
                                             | (questions sniffées)
                                             v
+-----------------+        HTTP        +-----+-------------------+         HTTPS
|  Navigateur     | <----------------> |  server.py              | <-------------->  DeepSeek API
|  React build    |   GET/POST/PATCH   |  ThreadingHTTPServer    |  (génération QROC,
|  /captures      |   /api/...         |  127.0.0.1:8765         |   max 6 calls concurrents)
|  /entrainement  |                    |                         |
+-----------------+                    +-----+-------------------+
                                             |
                                             | read/write JSON
                                             v
                                    +-------------------+
                                    |  data/            |
                                    |   captures/       |
                                    |   annales/        |
                                    |   exam-sessions/  |
                                    +-------------------+
```

**3 surfaces** :
- **Extension MV3** (`D:\Hypocampus\` racine, hors scope de ce doc, voir HANDOVER.md)
- **Web React** (`local-site/web/`) — build Vite statique servi par le serveur Python
- **API HTTP locale** (`local-site/server.py`) — ce doc se concentre ici

**Périmètre du document** : serveur Python + modèle de données. Pas l'extension. Pas l'UI React (audit séparé).

---

## 2. Stack backend

| Composant | Version / Choix | Justification |
|---|---|---|
| HTTP | `http.server.ThreadingHTTPServer` | 1 thread par requête. Pas async, pas WSGI. Suffisant pour single-user local. Voir [ADR 001](#adr-001--pourquoi-httpserver-et-pas-flaskfastapi). |
| Parsing PDF | PyMuPDF (`fitz`) | Extraction layout + bounding boxes + images natives. Voir [ADR 004](#adr-004--pourquoi-pymupdf-fitz-et-pas-pdfplumberpypdf). |
| LLM | DeepSeek API (`urllib.request`) | Single appel HTTPS, retry 429 avec backoff (5s/15s/45s). Timeout 900s pour les longs prompts. |
| Web | React/Vite/Tailwind/shadcn | Build statique servi par `_serve_static()` ligne 2276. |
| Storage | JSON-on-disk (pas de DB) | Volume actuel ne le justifie pas. Voir [ADR 002](#adr-002--pourquoi-json-on-disk-et-pas-sqlite). |
| Validation | Manuelle (isinstance, regex) | Pas de Pydantic. Cible Phase 1 de modularisation. |
| Logging | `print()` + `traceback.print_exc()` | Pas de logging structuré. Cible Phase 1. |

**Tailles** :
- `server.py` : **3 432 lignes** (mai 2026), fichier monolithe
- Fonction la plus longue : `do_POST` ~548 lignes
- Fonction critique : `run_qroc_generation_job` ~225 lignes (state machine threadée)

**Binding strict** : `HOST = "127.0.0.1"` ligne 31, `PORT = 8765`. Jamais exposé LAN/Internet.

---

## 3. Organisation du code

`server.py` est un monolithe organisé par domaines imbriqués. Pas (encore) de modularisation en packages.

### Domaines présents

| Domaine | Lignes approx. | Responsabilité |
|---|---|---|
| Constantes & helpers | 1–150 | Chemins, regex `SAFE_ID`, MIME types, slugs, JSON IO |
| Indexation captures | 149–200 | Signatures anti-doublon (`_session_index`, `_content_index`) |
| Annales (training) | 206–371 | Cache RAM, grading global, grading par question, stripping mode play |
| Sessions d'examen | 374–424 | Historique, stockage, scoring |
| PDF parsing (import local) | 546–642 | Parser UNESS textuel, extraction images |
| Parsing QROC | 919–1065 | Découpage en blocs source, layout reconstruction |
| Validation blocs QROC | 868–907 | Warnings sévérité (error/warning/info) |
| DeepSeek client | 777–827, 1177–1221 | Calls JSON, retry 429, semaphore concurrence |
| Génération QROC | 1090–1281 | Prompts génération + QA, normalisation |
| Job worker QROC | 1511–1813 | Queue + ThreadPoolExecutor, state machine |
| Routes HTTP | 2232–3409 | Dispatch via 50+ `re.match`, handlers inlined |

### État global mutable

À surveiller car partagé entre threads HTTP :

| Variable | Type | Lock | Lignes |
|---|---|---|---|
| `_annales_cache` | dict | ⚠️ aucun (RISQUE) | 207 (déclaration) |
| `_session_index` | dict | ⚠️ aucun (RISQUE) | 150 |
| `_content_index` | dict | ⚠️ aucun (RISQUE) | 151 |
| `QROC_JOB_QUEUE` | queue.Queue | thread-safe natif | 53 |
| `QROC_CANCEL_REQUESTS` | set | ⚠️ aucun (mineur) | 59 |
| `QROC_WORKER_STARTED` | bool | `QROC_JOB_LOCK` ✓ | 58 |

### Locks existants

| Lock | Portée | Couvre |
|---|---|---|
| `QROC_FILE_LOCK` | `read_json_file`, `write_json_file` (lignes 504-515) | I/O fichiers JSON (drafts, annales publiées) |
| `QROC_JOB_LOCK` | `start_qroc_worker` ligne 1534 | Démarrage idempotent du pool |
| `state_lock` | local à `run_qroc_generation_job` ligne 1611 | Mutations du draft pendant génération |
| `DEEPSEEK_CALL_SEMAPHORE` | Semaphore(6) ligne 65 | Borne le nombre d'appels DeepSeek simultanés |

---

## 4. Modèle de données (filesystem JSON)

Pas de DB. Tout est sérialisé en JSON sur disque, organisé par dossier.

### Types de fichiers

#### `data/captures/q_<qid>.json` — Captures extension

Questions snappées depuis hypocampus.fr par l'extension Chrome.

```json
{
  "id": "9aFx7K2pQwL",
  "format": "QI" | "DP" | "KFP",
  "subject": "Cardiologie",
  "url": "https://hypocampus.fr/...",
  "questionText": "...",
  "correctionText": "...",
  "options": [{ "id": "A", "text": "...", "correct": true }],
  "selectedAnswers": ["A", "C"],
  "seenAgain": [{ "date": "2026-05-...", "score": "juste" }],
  "imageB64": "data:image/png;base64,..."
}
```

Volume : ~190 actuellement. Projection : ~5000 (~3 ans à 5/jour).

#### `data/annales/<annaleId>.json` — Annales publiées

Issues d'un import local (parseur UNESS) ou d'un draft QROC publié.

```json
{
  "id": "cardio-correction-2023-s1",
  "title": "Cardio 2023 S1",
  "subject": "Cardiologie",
  "year": 2023,
  "session": "S1",
  "questions": [
    {
      "id": "q1",
      "questionType": "QRU" | "QRM" | "QROC" | "ZONE",
      "text": "...",
      "image": "q1.png",
      "options": [{ "id": "A", "text": "...", "correct": true }],
      "expectedAnswer": "...",  // QROC only
      "correctionText": "...",
      "seriesId": "dp1",        // grouping DP/KFP
      "seriesFormat": "DP",
      "seriesPosition": 1,
      "seriesTotal": 7,
      "vignette": "..."
    }
  ]
}
```

Volume : 16 annales actuellement. Projection : ~100-150 sur 2 ans.

#### `data/annales/<annaleId>/img/*.png` — Images annales
Servies par `GET /api/annales/<id>/img/<filename>` avec validation `safe_filename` + `normpath` (ligne 432).

#### `data/annales/_drafts/draft_<id>.json` — Brouillons QROC

```json
{
  "id": "draft_9iyr9n6QJiQ",
  "kind": "qroc-conversion",
  "status": "source-ready" | "generated" | "generated-with-errors" | "published",
  "meta": { "annaleId": "...", "title": "...", "subject": "...", "year": 2026, "session": "S1" },
  "sourceBlocks": [
    {
      "id": "block-1",
      "title": "DP1 — Cardio Bauters",
      "pages": [1, 2],
      "rawText": "...",
      "cleanText": "...",
      "images": [...],
      "warnings": [{ "code": "short-block", "message": "...", "severity": "error" }]
    }
  ],
  "generatedQuestions": [...],
  "generationReport": {
    "warnings": ["block-1: ..."],
    "errors": [...],
    "infos": [...]
  },
  "publishLog": { "annaleId": "...", "publishedAt": "...", "autoRenamed": false }
}
```

Volume : 30 actuellement (incluant les drafts publiés conservés pour audit).

#### `data/annales/_drafts/jobs/job_<id>.json` — Jobs DeepSeek

```json
{
  "id": "job_YdLdMBxkAEw",
  "draftId": "draft_9iyr9n6QJiQ",
  "status": "queued" | "running" | "checking" | "done" | "done-with-errors" | "error" | "cancelled" | "interrupted",
  "progress": {
    "current": 2,
    "total": 4,
    "phase": "generating" | "checking" | "done",
    "currentBlockId": "block-2",
    "activeBlockIds": ["block-2", "block-3"]
  },
  "usage": [{ "blockId": "block-1", "generation": { "tokens": ... } }],
  "errors": [],
  "createdAt": "2026-05-21T00:36:05Z",
  "updatedAt": "2026-05-21T00:40:37Z",
  "workerConfig": { "jobWorkers": 2, "blockWorkers": 4, "deepseekMaxConcurrentCalls": 6, "skipQa": false }
}
```

#### `data/exam-sessions/<sessionId>.json` — Sessions d'examen

Copies des réponses étudiantes après chaque test.

```json
{
  "id": "ses_abc123",
  "annaleId": "cardio-correction-2023-s1",
  "annaleTitle": "Cardio 2023 S1",
  "annaleSubject": "Cardiologie",
  "annaleYear": 2023,
  "annaleSession": "S1",
  "mode": "exam" | "libre",
  "startedAt": "...",
  "submittedAt": "...",
  "durationSec": 1842,
  "answers": { "q1": ["A"], "q2": "réponse libre" },
  "finalScore": { "juste": 38, "faux": 12, "non_comptee": 14, "total": 64, "noteSur": 50, "note": 38 },
  "details": [{ "id": "q1", "evaluation": "juste", ... }]
}
```

Volume : 0 actuellement. Projection : ~500-2000 sur 2 ans.

### Gestion des IDs

- Tous les IDs validés par `SAFE_ID = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")` ligne 50.
- Slugification via `safe_slug()` (lowercase, accents retirés, max 80 chars).
- IDs aléatoires pour drafts/jobs : `generate_qroc_id(prefix)`.
- Anti-collision au publish : auto-rename en `<id>-2`, `<id>-3`... jusqu'à `<id>-20` si l'ID est déjà pris (ligne 2615).
- Rename d'annale possible via `PATCH /api/annales/<id>` avec champ `newId` (ligne 3105) — propage aux sessions historique + publishLog des drafts.

---

## 5. Threading & cohérence

### Modèle de concurrence

```
                  +-------------------------+
                  |  ThreadingHTTPServer    |
                  |  1 thread par requête   |
                  +-----------+-------------+
                              |
              +---------------+----------------+
              |                                |
              v                                v
      +-------+------+                +--------+--------+
      |  Routes HTTP |                |  QROC Worker    |
      |  (do_GET/    |   enqueue      |  Pool 2 threads |
      |   POST/      |  ----------->  |  daemon         |
      |   PATCH/     |                |                 |
      |   DELETE)    |                |  Dépile         |
      +--------------+                |  QROC_JOB_QUEUE |
                                      +--------+--------+
                                               |
                                               v
                                      +--------+--------+
                                      |  Block          |
                                      |  ThreadPoolExec |
                                      |  max_workers=4  |
                                      |  per job        |
                                      +--------+--------+
                                               |
                                               | borné par
                                               v
                                      +--------+--------+
                                      |  Semaphore(6)   |
                                      |  DeepSeek calls |
                                      +-----------------+
```

### Recovery au redémarrage

`mark_interrupted_qroc_jobs()` ligne 1537 marque tous les jobs avec `status in {queued, running, generating, checking}` comme `interrupted` au boot. L'utilisateur peut alors les relancer depuis l'UI.

### Atomic writes

- ✅ **Annales et drafts** : passent par `write_json_file()` ligne 502-515 → `.tmp` + `os.replace()` (atomique cross-platform).
- ⚠️ **Captures et exam-sessions** : écritures directes sans pattern atomic. RISQUE de corruption en cas de crash. À corriger (Phase 0).

### Cache RAM

`_annales_cache` (dict ligne 207) est rempli au démarrage par `load_annales()` et mis à jour après chaque publish/patch. Pas de revalidation périodique : si quelqu'un modifie un JSON à la main pendant que le serveur tourne, le cache reste périmé.

---

## 6. Endpoints publics

### Captures (extension)

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/captures` | Liste light (sans imageB64) |
| GET | `/api/captures/<qid>` | Détail complet |
| POST | `/api/captures` | Création / push depuis extension |
| PATCH | `/api/captures/<qid>` | Édite `customTitle`, `chapter` |
| DELETE | `/api/captures/<qid>` | Supprime |

### Annales

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/annales` | Liste résumée par matière |
| GET | `/api/annales/<id>` | Détail (mode play : `correct`, `expectedAnswer`, `correctionText`, `correctedImage` strippés) |
| GET | `/api/annales/<id>/img/<filename>` | Image, path traversal protégé |
| GET | `/api/annales/<id>/source.pdf` | PDF original si stocké |
| POST | `/api/annales/<id>/grade` | Note finale après submit |
| POST | `/api/annales/<id>/grade-one` | Note d'une seule question (mode libre) |
| PATCH | `/api/annales/<id>` | Édite title/subject/year/session/`newId` (rename) |
| DELETE | `/api/annales/<id>` | Supprime |
| POST | `/api/annales/import/local` | Import via parseur UNESS local (PyMuPDF) — mode UI « Faculté » |

### Drafts QROC

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/annales/drafts` | Liste des brouillons |
| GET | `/api/annales/drafts/<id>` | Détail |
| GET | `/api/annales/drafts/<id>/img/<filename>` | Images de bloc |
| POST | `/api/annales/convert-qroc/extract` | Découpe le PDF en blocs source (`profile` : `qroc` défaut, ou `faithful` pour le mode « Autre », cf. ADR 008) |
| POST | `/api/annales/convert-qroc/drafts/<id>/generate` | Lance la génération DeepSeek (async). Bimodal : extrait le corrigé s'il existe, sinon le génère par IA (`answerSource`, cf. ADR 007) |
| GET | `/api/annales/convert-qroc/jobs/<id>` | Statut du job (polling 1500ms) |
| POST | `/api/annales/convert-qroc/jobs/<id>/cancel` | Annule un job en cours |
| PATCH | `/api/annales/drafts/<id>` | Édite blocs ou questions générées |
| PATCH | `/api/annales/convert-qroc/drafts/<id>/source-blocks` | Sauve uniquement les blocs |
| POST | `/api/annales/drafts/<id>/publish` | Publication finale (avec auto-rename si collision) |
| DELETE | `/api/annales/drafts/<id>` | Supprime |

### Exam sessions

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/exam-sessions` | Liste résumée |
| GET | `/api/exam-sessions/<id>` | Détail (réponses + corrections) |
| POST | `/api/exam-sessions` | Sauvegarde après submit |
| DELETE | `/api/exam-sessions/<id>` | Supprime |

### Admin

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/health` | Ping de connectivité |
| GET | `/api/dedupe-scan` | Scan disque captures pour détecter doublons (O(n), lent) |
| GET | `/api/admin/backups` | Liste backups zip |
| POST | `/api/admin/backup` | Crée un backup ad-hoc |
| DELETE | `/api/admin/backups/<filename>` | Supprime un backup |
| GET | `/api/admin/orphan-vignettes` | Diagnostic regex des vignettes manquantes (C1) |
| GET | `/api/admin/annales/<aid>/questions/<qid>` | Détail RAW d'une question (avec `correct`, `correctionText`) pour l'éditeur admin |

### Signalements & corrections (système coquilles de parsing)

Permet à l'utilisateur de baliser des coquilles en pleine session puis de les corriger ciblé via une page admin dédiée.

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/reports` | Crée un signalement utilisateur |
| GET | `/api/reports?status=open\|resolved\|all` | Liste filtrée |
| GET | `/api/reports/summary` | Compteur léger pour badge UI (open + autoOrphan) |
| PATCH | `/api/reports/<id>` body `{status:"resolved"}` | Ferme un signalement |
| PATCH | `/api/annales/<aid>/questions/<qid>` | Édite ciblée Niveau 2 (textes + options.correct + expectedAnswer) |
| PATCH | `/api/annales/<aid>/questions/<qid>?dryRun=1` | Mode dry-run : retourne `wouldChange` + `sessionsImpacted` sans muter |
| POST | `/api/annales/<aid>/regroup-to-dp` | Conversion rétroactive QI → série DP/KFP |

**Stockage** : `data/_reports.jsonl` (append-only, JSONL, gestion par `core.storage.ReportStore`).

**UI** :
- `exam-page` : pastille `!` (signaler) + pastille `✎` (corriger direct) sur chaque question
- `/admin/corrections` : vue unifiée détections auto + signalements user, filtres status/source/catégorie, deep-link `?q=` sur Relire, badge orphan si annale supprimée
- Badge compteur sur le NavTile Corrections, refresh à chaque changement de route

**Garde-fous PATCH question** :
- Champs interdits : `id`, `questionType`, `format`, `seriesId*` (cf. `QUESTION_PATCH_FORBIDDEN`)
- Backup auto via `BackupManager` avant 1ère mutation de la session (tracker `_patch_backup_done`)
- Validation à la frontière via `QuestionPatchPayload` (core.models)
- Audit log obligatoire (`annale_question_patched`)
- Atomic write + cache `_annales_cache` invalidé

---

## 7. Risques critiques actuels

À corriger en **Phase 0** (3-4h de travail au total).

### Risque 1 — Race conditions sur `_session_index` et `_content_index`

- **Localisation** : `server.py` lignes 150-200, mutations dispersées (lignes ~171, 2926-2967)
- **Description** : 2 dict globaux d'index anti-doublon, mutés sans lock depuis plusieurs threads HTTP
- **Symptôme attendu** : doublons captures qui apparaissent occasionnellement
- **Fix** :
  ```python
  INDEX_LOCK = threading.Lock()
  # Wrap toutes lectures/écritures :
  with INDEX_LOCK:
      _session_index[sig] = qid
  ```
- **Effort** : ~30 min

### Risque 2 — Atomic writes manquants sur captures et sessions

- **Localisation** : `server.py` ~ligne 2898 (sessions), ~2980 (captures)
- **Description** : écritures directes sans `.tmp` + `os.replace()`
- **Symptôme attendu** : JSON corrompu si crash en milieu d'écriture, serveur refuse de démarrer
- **Fix** : passer toutes les écritures par `write_json_file()` (existe déjà ligne 502)
- **Effort** : ~20 min

### Risque 3 — Pas de backup automatique

- **Description** : `data/` non versionné, pas de copie périodique
- **Conséquence** : disque mort = perte totale (annales + captures + historique)
- **Fix** : endpoint `/api/admin/backup` qui crée un zip horodaté dans `archives/`, déclenché 1×/jour par le frontend
- **Effort** : ~1h30

### Risque 4 — Rename d'annale non transactionnel

- **Localisation** : `server.py` lignes ~3215-3231
- **Description** : multi-fichiers (annale JSON + dossier images + N sessions + drafts publishLog), pas de rollback en cas de crash
- **Symptôme** : si crash au milieu, certaines sessions pointent vers l'ancien ID, d'autres vers le nouveau
- **Fix** : audit log `data/_audit.jsonl` qui trace chaque écriture → script de réparation
- **Effort** : ~1h

---

## 8. Limites prévisibles par volume

| Type | Aujourd'hui | Seuil de gêne | Seuil de blocage |
|---|---|---|---|
| Annales | 16 | ~150 (`load_annales` >500 ms) | ~500 (>2 s startup) |
| Exam sessions | 0 | ~500 (UI lente) | ~5000 (10 MB JSON envoyé client) |
| Captures | 190 | ~500 (`dedupe-scan` lent) | ~2000 (>10 s scan) |
| Drafts QROC | 30 | ~50 (listing OK) | ~200 (lourd à scanner) |

### Limites structurelles (indépendantes du volume)

- **Pas d'agrégation** : impossible de calculer `AVG(score) WHERE subject='Cardiologie'` sans tout charger en RAM
- **Pas de full-text search** sur les questions / corrections
- **Pas de pagination côté serveur** : tout est renvoyé au client, qui filtre en JS
- **Pas de filtres serveur** (date range, score range, etc.)
- **Pas d'auth** : impossible en multi-user / cloud
- **Pas de transactions multi-fichiers** : risque d'incohérence (cf Risque 4)

---

## 9. Plan d'évolution en 3 phases

### Phase 0 — Stabilisation urgente (3-4h, à faire maintenant)

| Action | Effort |
|---|---|
| Lock sur `_session_index` + `_content_index` (Risque 1) | 30 min |
| Atomic writes captures + sessions (Risque 2) | 20 min |
| Endpoint backup auto + bouton UI (Risque 3) | 1h30 |
| Audit log `data/_audit.jsonl` (Risque 4) | 1h |

**Après Phase 0** : robuste pour 6+ mois quoi qu'il arrive.

### Phase 1 — Modularisation (1-2 jours, dans 1-2 mois)

Découpage de `server.py` (3432 lignes monolithe) en :

```
local-site/
├── server.py            # entrypoint + routing dispatch (~300 lignes)
├── handlers/
│   ├── annales.py       # GET/POST/PATCH/DELETE annales (~500 lignes)
│   ├── captures.py      # API extension (~300 lignes)
│   ├── qroc.py          # workflow QROC complet (~800 lignes)
│   └── exam_sessions.py # historique (~200 lignes)
├── core/
│   ├── parsing.py       # PyMuPDF + UNESS parser (~500 lignes)
│   ├── deepseek.py      # client + retry + prompts (~400 lignes)
│   ├── storage.py       # read/write JSON atomique + locks (~150 lignes)
│   └── models.py        # dataclasses + Pydantic (~200 lignes)
```

+ Pydantic à la frontière des requêtes
+ Tests unitaires sur modules critiques (parsing, grading, dedup)

**Gain** : ajouter une feature sans peur de casser le reste.

### Phase 2 — Bascule SQLite (3-5 jours, déclenchée par un signal)

**Signaux déclencheurs** (ne pas anticiper) :
- >50 sessions/mois ET besoin de stats agrégées (graphes progression, moyennes par matière)
- >200 annales (load_annales lent au démarrage)
- Feature spaced repetition envisagée
- Partage local avec 2-3 amis (multi-user but still local)

**Stratégie** :
- Tables : `annales`, `questions`, `options`, `captures`, `exam_sessions`, `answers`
- Garder JSON en lecture pendant 2 semaines (fallback)
- Script `migrate.py` qui lit `data/*.json` → écrit en SQL
- Endpoint `/api/admin/export-all` pour reconstruire les JSON depuis SQL

**Gains immédiats** :
- Stats agrégées en 1 requête
- FTS5 SQLite pour search full-text
- Pagination native (`LIMIT/OFFSET`)
- Foreign keys + cascade delete
- Transactions ACID multi-tables

### Phase 3 — FastAPI + ASGI (1-2 semaines, si jamais)

À considérer **uniquement** si :
- Déploiement cloud pour partager avec une promo
- Mobile natif / PWA avec sync
- Temps réel (websockets pour stats partagées)

Stack cible : **FastAPI + SQLAlchemy + SQLite/Postgres + Uvicorn**. Refactor ~50% du code. **Over-engineering** pour usage solo local actuel — ne pas faire prématurément.

---

## 10. Décisions techniques (ADR-style)

Décisions documentées pour ne pas les remettre en question dans 6 mois.

### ADR 001 — Pourquoi `http.server` et pas Flask/FastAPI

- **Contexte** : single-user local, pas de besoin async
- **Coût Flask/FastAPI** : +30% de lignes, dépendance externe, gains marginaux à ce stade
- **Décision** : garder `http.server` jusqu'à Phase 3
- **Revisit** : si on passe en cloud ou multi-user

### ADR 002 — Pourquoi JSON-on-disk et pas SQLite

- **Contexte** : volume <50 annales, <500 sessions au démarrage
- **Atouts JSON** : simplicité, git-friendly, debug facile (`cat file.json | jq`), migration triviale (`cp -r data/`)
- **Coût SQLite** : ~3-5 jours migration + dépendance binaire
- **Décision** : JSON tant que volume <500 sessions ET pas de besoin de stats agrégées
- **Revisit** : Phase 2 (déclenchée par les signaux ci-dessus)

### ADR 003 — Pourquoi SQLite et pas Postgres (le jour où on migre)

- **Contexte** : single-user local probable encore 2-3 ans
- **Coût Postgres** : besoin d'un service système (daemon), admin, backups distincts
- **Atouts SQLite** : 1 fichier, zero config, backup trivial (`cp data.db backup.db`), WAL mode pour concurrence light, libraries Python natives (`sqlite3`)
- **Décision** : SQLite suffit jusqu'à ~100 utilisateurs concurrents
- **Revisit** : si déploiement cloud avec >10 utilisateurs simultanés

### ADR 004 — Pourquoi PyMuPDF (fitz) et pas pdfplumber/pypdf

- **Critères** : extraction layout (coordonnées), images, vitesse
- **pdfplumber** : API plus simple mais 3-5× plus lent + pas d'extraction images
- **pypdf** : basique, pas de layout
- **fitz** : extraction structurée + bounding boxes + images natives. Choix solide.
- **Décision** : garder fitz, pas de revisit prévu

### ADR 005 — Pourquoi 2 worker threads QROC et semaphore=6

- DeepSeek **ne publie pas** de limite RPM/TPM. 429 dynamique selon charge serveur.
- Empirique : ~8-10 appels concurrents = seuil 429
- Choix conservateur : **6 max simultanés** via `DEEPSEEK_CALL_SEMAPHORE`
- 2 workers × 4 blocs/job parallèles ⇒ potentiellement 8 calls, limités à 6 par le semaphore
- **Revisit** : si DeepSeek publie des chiffres officiels

### ADR 006 — Auto-rename `<id>-2`, `<id>-3` au publish

- **Contexte** : utilisateur veut souvent refaire une annale déjà publiée sans écraser
- **Alternatives évaluées** : 1) renommer manuellement les anciens, 2) modal au conflit, 3) auto-rename
- **Décision** : option 3 (auto) + bouton crayon dans le panneau succès pour reprendre la main sur le nom
- **Pourquoi** : 4 clics au lieu de 8, zéro risque sur l'historique, contrôle disponible si besoin
- **Localisation** : `server.py` ligne 2615

### ADR 007 — Corrigé généré par IA quand le PDF n'en contient pas

- **Contexte** : certains sujets (ex. cahiers de QROC) sont distribués **sans corrigé**. Le pipeline Conversion QROC supposait que le bloc source contenait toujours le corrigé (« le bloc source est la seule source de vérité, ne rien inventer ») → sans corrigé, `expectedAnswer` restait vide.
- **Décision** : `build_qroc_generation_prompt` devient **bimodal**. Pour chaque question, DeepSeek renvoie `answerSource` :
  - `"source"` (défaut sûr) : la réponse est dans le bloc → comportement strict inchangé (fidèle, jamais inventer, `sourceRefs` = extraits exacts).
  - `"ai"` : le bloc ne contient pas la réponse → DeepSeek répond depuis ses connaissances médicales (référentiels EDN/collèges).
- **Garde-fou (médecine)** : un corrigé `ai` n'est **jamais** présenté comme officiel. Badge ambre « Corrigé généré par IA — à vérifier » en revue de brouillon ET dans la correction d'examen (le label « Réponse officielle » devient conditionnel). Revue avant publication conservée. Détection biaisée vers `"source"` (en cas de doute, vide plutôt qu'inventer).
- **Le parsing reste 100 % local** : DeepSeek ne parse/découpe toujours rien (PyMuPDF déterministe). Il ne fait que **répondre** — exception documentée et bornée au seul cas « corrigé absent ».
- **QA check** : les questions `ai` sont exclues du contrôle qualité (qui suppose « bloc source = corrigé officiel »).
- **Persistance** : `answerSource` est porté par `normalize_qroc_generated_questions`, **préservé par `validate_imported_annale`** (sinon perdu au publish), et renvoyé dans les détails de `grade_annale`/`grade_one_question`. Non sensible → traverse `annale_for_play` (ne révèle pas la réponse).
- **Localisation** : `server.py` (`build_qroc_generation_prompt`, `normalize_qroc_generated_questions`, `validate_imported_annale`, `grade_*`). UI : `annale-import-page.tsx`, `exam-page.tsx`.

### ADR 008 — Mode d'import « Autre » (transcription fidèle de PDF variés)

- **Contexte** : la page d'import avait 2 modes — **Faculté** (ex-« Import local », parseur UNESS
  déterministe, rejette tout autre format) et **QROC** (corrigé QROC → *expansion* en 3-6 QCM/bloc).
  Aucun ne couvre un PDF d'examen quelconque (non-UNESS, non-QROC), surtout sans corrigé.
- **Décision** : 3ᵉ mode **« Autre »** (`profile="faithful"`) — **transcription fidèle 1:1**.
  Découpage local générique → DeepSeek **reproduit chaque question existante** (détecte son type
  QRU/QRM/QROC, **ne fusionne pas, n'invente pas, n'expanse pas**), et **génère le corrigé via
  `answerSource="ai"`** s'il est absent (réutilise le mécanisme bimodal d'ADR 007).
- **Contrainte respectée** : `/import/deepseek` (PDF entier brut → DeepSeek) reste **désactivé**.
  « Autre » fait **découpage 100 % local d'abord** (`parse_qroc_source_pdf(profile="faithful")` :
  marqueurs génériques `is_generic_question_start` + sous-découpe par taille), DeepSeek ne structure
  que des blocs déjà découpés — plus conservateur que QROC (fidèle, pas génératif).
- **Gate strict** : `profile="qroc"` (défaut) laisse Faculté et QROC **inchangés** (zéro régression).
  En faithful : QA forcément sauté, warnings de découpage auto-acceptés.
- **UX** : flux simplifié dédié (`AutreImportPanel`) — dépôt PDF → extraction + génération auto →
  **un écran de revue** (réutilise `QuestionEditor`, badges `answerSource=ai`) → publication.
- **Localisation** : `core/qroc_blocks.py` (`is_generic_question_start`), `core/parsing.py`
  (`_faithful_segments`, `parse_qroc_source_pdf(profile=…)`), `server.py`
  (`build_faithful_transcription_prompt`, wiring `run_qroc_generation_job`/extract). UI : `annale-import-page.tsx`.

---

## 11. Points forts à préserver

Ne pas casser ces invariants en refactorisant.

- **IDs validés par regex stricte** `SAFE_ID` → pas d'injection, pas de path traversal
- **Anti-leak** : `annale_for_play()` ligne 260 strip `correctionText`, `expectedAnswer`, `correctedImage`, `options[].correct` avant envoi en mode play
- **Provenance corrigé** : `answerSource` (`source`/`ai`) distingue corrigé officiel et corrigé généré par IA ; le badge « à vérifier » + le label conditionnel ne doivent jamais laisser un corrigé IA passer pour officiel (cf. ADR 007)
- **Grading 100% serveur** : le client ne peut pas truquer son score (ligne 303-345)
- **API key DeepSeek** : reçue en body, jamais loggée, jamais persistée
- **Path traversal protégé** sur tous les endpoints qui servent un fichier (`safe_filename`, `normpath + startswith`)
- **Cache `_annales_cache`** pour reads fréquents (mais à protéger avec un lock en Phase 0)
- **Migration machine triviale** (`cp -r data/`)
- **Polling QROC jobs** avec backoff exponentiel sur 429 (5s / 15s / 45s)
- **Recovery au boot** : `mark_interrupted_qroc_jobs` marque les jobs orphelins
- **Auto-rename publication** : pas de friction quand on refait une annale déjà publiée

---

## 12. Annexes

### Constantes config

| Constante | Valeur | Fichier:Ligne | Description |
|---|---|---|---|
| `HOST` | `"127.0.0.1"` | server.py:31 | Binding strict local |
| `PORT` | `8765` | server.py:32 | Port HTTP |
| `MAX_IMPORT_PAYLOAD_BYTES` | `80 MB` | server.py:52 | Limite upload PDF base64 |
| `QROC_JOB_WORKER_COUNT` | `2` | server.py:61 | Threads pool QROC |
| `QROC_BLOCK_WORKERS` | `4` | server.py:62 | Max blocs parallèles dans un job |
| `DEEPSEEK_MAX_CONCURRENT_CALLS` | `6` | server.py:63 | Semaphore global DeepSeek |
| `DEEPSEEK_RETRY_DELAYS` | `(5, 15, 45)` | server.py:64 | Backoff exponentiel 429 |
| `SAFE_ID` | regex `^[A-Za-z0-9_\-]{1,80}$` | server.py:50 | Validation IDs (anti path traversal) |

### Glossaire

| Terme | Signification |
|---|---|
| **EDN** | Épreuves Dématérialisées Nationales (examen médecine FR) |
| **QI** | Question Indépendante |
| **DP** | Dossier Progressif (vignette cumulative + N questions) |
| **KFP** | Key Feature Problem (similaire DP) |
| **QRU** | Question à Réponse Unique (1 bonne réponse) |
| **QRM** | Question à Réponse Multiple (plusieurs bonnes) |
| **QROC** | Question à Réponse Ouverte Courte (texte libre) |
| **ZONE** | Question avec image à localiser |
| **UNESS** | Plateforme officielle de l'EDN |
| **Hypocampus** | Plateforme privée de révision (sniffée par l'extension) |

### Commandes utiles

```bash
# Démarrer le serveur (depuis local-site/)
python server.py

# Build du front (depuis local-site/web/)
npm run build

# Test rapide d'un endpoint
curl -s http://127.0.0.1:8765/api/annales | python -m json.tool

# Backup manuel
cp -r data/ ../archives/data-$(date +%Y%m%d)
```

### Références

- `D:\Hypocampus\README.md` — Vue d'ensemble du projet (extension + site)
- `D:\Hypocampus\HANDOVER.md` — Contexte produit + journal de passation
- `D:\Hypocampus\local-site\data\annales\README.md` — Format JSON d'une annale
- DeepSeek docs : https://api-docs.deepseek.com (rate limits dynamiques, pas de chiffres publics)
- PyMuPDF docs : https://pymupdf.readthedocs.io

---

**Pour signaler une erreur ou demander une mise à jour de ce document** : update direct sur ce fichier + bump la date "Dernière revue" en tête.
