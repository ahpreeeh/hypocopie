"""
core.models — Modèles de données typés (dataclasses standard Python).

Choix : `dataclasses` plutôt que Pydantic pour rester sans dépendance externe.
Suffisant pour typer les structures principales du domaine et offrir des
constructeurs `MyClass.from_dict()` qui valident à la frontière des requêtes.

Issu de Phase 1 de la modularisation.

USAGE :
    >>> from core.models import ExamSessionPayload
    >>> session = ExamSessionPayload.from_dict(payload)
    >>> session.validate()  # lève ValueError si invalide
"""

from dataclasses import dataclass, field
from typing import Any, Optional


# ────────────────────────────────────────────────────────────────────
# Helpers de validation
# ────────────────────────────────────────────────────────────────────


def _require_str(value: Any, field_name: str, max_len: int = 1000) -> str:
    """Vérifie qu'une valeur est une string non-vide après strip."""
    if not isinstance(value, str):
        raise ValueError(f"{field_name} : string attendue")
    cleaned = value.strip()[:max_len]
    if not cleaned:
        raise ValueError(f"{field_name} : ne peut pas être vide")
    return cleaned


def _optional_str(value: Any, max_len: int = 1000) -> Optional[str]:
    """Convertit en string si possible, retourne None sinon."""
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    cleaned = value.strip()[:max_len]
    return cleaned or None


def _optional_int(value: Any) -> Optional[int]:
    """Convertit en int si possible, retourne None sinon."""
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ────────────────────────────────────────────────────────────────────
# Annales / questions
# ────────────────────────────────────────────────────────────────────


@dataclass
class Option:
    """Une option de réponse pour QRU/QRM."""
    id: str
    text: str
    correct: bool = False

    @classmethod
    def from_dict(cls, data: dict) -> "Option":
        return cls(
            id=_require_str(data.get("id"), "Option.id", max_len=8),
            text=_require_str(data.get("text"), "Option.text", max_len=2000),
            correct=bool(data.get("correct")),
        )


@dataclass
class Question:
    """Une question d'annale (QRU / QRM / QROC / ZONE)."""
    id: str
    questionType: str  # QRU | QRM | QROC | ZONE
    text: str
    image: Optional[str] = None
    options: list = field(default_factory=list)  # List[Option]
    expectedAnswer: Optional[str] = None
    correctionText: Optional[str] = None
    seriesId: Optional[str] = None
    seriesFormat: Optional[str] = None  # DP | KFP
    seriesPosition: Optional[int] = None
    seriesTotal: Optional[int] = None
    vignette: Optional[str] = None
    customTitle: Optional[str] = None
    sourceRefs: list = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> "Question":
        qtype = _require_str(data.get("questionType"), "Question.questionType", max_len=10)
        if qtype not in {"QRU", "QRM", "QROC", "ZONE"}:
            raise ValueError(f"questionType invalide : {qtype}")
        return cls(
            id=_require_str(data.get("id"), "Question.id", max_len=80),
            questionType=qtype,
            text=_require_str(data.get("text"), "Question.text", max_len=10000),
            image=_optional_str(data.get("image"), max_len=200),
            options=[Option.from_dict(o) for o in (data.get("options") or []) if isinstance(o, dict)],
            expectedAnswer=_optional_str(data.get("expectedAnswer"), max_len=2000),
            correctionText=_optional_str(data.get("correctionText"), max_len=10000),
            seriesId=_optional_str(data.get("seriesId"), max_len=80),
            seriesFormat=_optional_str(data.get("seriesFormat"), max_len=10),
            seriesPosition=_optional_int(data.get("seriesPosition")),
            seriesTotal=_optional_int(data.get("seriesTotal")),
            vignette=_optional_str(data.get("vignette"), max_len=20000),
            customTitle=_optional_str(data.get("customTitle"), max_len=300),
            sourceRefs=[str(r) for r in (data.get("sourceRefs") or []) if r],
        )


@dataclass
class AnnaleMeta:
    """Métadonnées d'une annale (pas les questions)."""
    id: str
    title: str
    subject: str
    year: Optional[int] = None
    session: Optional[str] = None
    studyYear: Optional[str] = None
    questionsCount: int = 0

    @classmethod
    def from_dict(cls, data: dict) -> "AnnaleMeta":
        return cls(
            id=_require_str(data.get("id"), "AnnaleMeta.id", max_len=80),
            title=_require_str(data.get("title"), "AnnaleMeta.title", max_len=200),
            subject=_require_str(data.get("subject"), "AnnaleMeta.subject", max_len=80),
            year=_optional_int(data.get("year")),
            session=_optional_str(data.get("session"), max_len=20),
            studyYear=_optional_str(data.get("studyYear"), max_len=40),
            questionsCount=_optional_int(data.get("questionsCount")) or 0,
        )


# ────────────────────────────────────────────────────────────────────
# Sessions d'examen
# ────────────────────────────────────────────────────────────────────


@dataclass
class ExamSessionPayload:
    """
    Payload reçu pour la création d'une session d'examen (POST /api/exam-sessions).
    Validation à la frontière : vérifie les champs requis avant de passer aux handlers.
    """
    annaleId: str
    mode: str  # "exam" | "libre"
    answers: dict
    startedAt: Optional[str] = None
    submittedAt: Optional[str] = None
    durationSec: Optional[int] = None
    finalScore: Optional[dict] = None
    details: list = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Any) -> "ExamSessionPayload":
        if not isinstance(data, dict):
            raise ValueError("payload doit être un objet JSON")
        mode = _require_str(data.get("mode"), "mode", max_len=10)
        if mode not in {"exam", "libre"}:
            raise ValueError(f"mode invalide : {mode} (attendu 'exam' ou 'libre')")
        # Si answers est explicitement fourni, valider strictement.
        # Si absent ou None, défaut = {}.
        if "answers" not in data or data["answers"] is None:
            answers = {}
        elif isinstance(data["answers"], dict):
            answers = data["answers"]
        else:
            raise ValueError("answers doit être un dict")
        return cls(
            annaleId=_require_str(data.get("annaleId"), "annaleId", max_len=80),
            mode=mode,
            answers=answers,
            startedAt=_optional_str(data.get("startedAt"), max_len=40),
            submittedAt=_optional_str(data.get("submittedAt"), max_len=40),
            durationSec=_optional_int(data.get("durationSec")),
            finalScore=data.get("finalScore") if isinstance(data.get("finalScore"), dict) else None,
            details=data.get("details") if isinstance(data.get("details"), list) else [],
        )


# ────────────────────────────────────────────────────────────────────
# Imports
# ────────────────────────────────────────────────────────────────────


@dataclass
class LocalImportMeta:
    """Métadonnées requises pour un import local d'annale (POST /api/annales/import/local)."""
    annaleId: str
    subject: str
    year: int
    session: str
    title: str
    studyYear: Optional[str] = None
    overwrite: bool = False

    @classmethod
    def from_dict(cls, data: Any) -> "LocalImportMeta":
        if not isinstance(data, dict):
            raise ValueError("payload doit être un objet JSON")
        year = _optional_int(data.get("year"))
        if year is None or year < 2000 or year > 2100:
            raise ValueError("year doit être entre 2000 et 2100")
        title = data.get("title")
        if not title:
            subject = data.get("subject") or ""
            session = data.get("session") or ""
            title = f"{subject} {year} {session}".strip()
        return cls(
            annaleId=_require_str(data.get("annaleId"), "annaleId", max_len=80),
            subject=_require_str(data.get("subject"), "subject", max_len=80),
            year=year,
            session=_optional_str(data.get("session"), max_len=80) or "",
            title=_require_str(title, "title", max_len=200),
            studyYear=_optional_str(data.get("studyYear"), max_len=40),
            overwrite=bool(data.get("overwrite")),
        )


@dataclass
class GradeAllPayload:
    """
    Payload pour POST /api/annales/<id>/grade — grading final après soumission.
    Le champ `answers` est une map {questionId: <réponse>}.
    """
    answers: dict

    @classmethod
    def from_dict(cls, data: Any) -> "GradeAllPayload":
        if not isinstance(data, dict):
            raise ValueError("payload doit être un objet JSON")
        # Si answers absent ou None : on tolère un dict vide (grade tout en faux)
        if "answers" not in data or data["answers"] is None:
            answers = {}
        elif isinstance(data["answers"], dict):
            answers = data["answers"]
        else:
            raise ValueError("answers doit être un dict {questionId: réponse}")
        return cls(answers=answers)


@dataclass
class GradeOnePayload:
    """
    Payload pour POST /api/annales/<id>/grade-one — grading mode libre (une question).
    """
    qid: str
    answer: Any = None  # peut être None, list, str selon questionType

    @classmethod
    def from_dict(cls, data: Any) -> "GradeOnePayload":
        if not isinstance(data, dict):
            raise ValueError("payload doit être un objet JSON")
        qid = data.get("qid") or data.get("questionId")
        if not isinstance(qid, str) or not qid.strip():
            raise ValueError("qid (ou questionId) manquant ou invalide")
        return cls(qid=qid.strip(), answer=data.get("answer"))


@dataclass
class RegroupToDPPayload:
    """
    Payload pour POST /api/annales/<id>/regroup-to-dp.

    Conversion rétroactive de questions QI (seriesId=null) vers une nouvelle
    série DP/KFP. Permet d'ajouter une vignette clinique partagée à des
    questions historiquement importées sans vignette.

    Champs requis :
    - questionIds : liste d'IDs (≥ 2) de questions QI à regrouper, dans l'ordre voulu
    - seriesTitle : titre du dossier clinique (≥ 1 char après strip)
    - vignette    : énoncé clinique partagé (≥ 20 chars après strip)
    - seriesFormat: "DP" (par défaut) ou "KFP"
    """
    questionIds: list  # list[str]
    seriesTitle: str
    vignette: str
    seriesFormat: str = "DP"

    @classmethod
    def from_dict(cls, data: Any) -> "RegroupToDPPayload":
        if not isinstance(data, dict):
            raise ValueError("payload doit être un objet JSON")

        raw_ids = data.get("questionIds")
        if not isinstance(raw_ids, list):
            raise ValueError("questionIds : liste attendue")
        question_ids: list = []
        seen = set()
        for qid in raw_ids:
            if not isinstance(qid, str):
                raise ValueError("questionIds : chaque ID doit être une string")
            cleaned = qid.strip()
            if not cleaned:
                raise ValueError("questionIds : ID vide non autorisé")
            if len(cleaned) > 80:
                raise ValueError(f"questionIds : ID trop long ({cleaned!r})")
            if cleaned in seen:
                raise ValueError(f"questionIds : doublon détecté ({cleaned!r})")
            seen.add(cleaned)
            question_ids.append(cleaned)
        if len(question_ids) < 2:
            raise ValueError("questionIds : au moins 2 questions requises pour former une série")

        series_title = _require_str(data.get("seriesTitle"), "seriesTitle", max_len=300)

        # vignette : on ne strip pas le contenu (on garde la mise en forme),
        # mais on contrôle qu'au moins 20 chars utiles après strip.
        vignette_raw = data.get("vignette")
        if not isinstance(vignette_raw, str):
            raise ValueError("vignette : string attendue")
        vignette_stripped = vignette_raw.strip()
        if len(vignette_stripped) < 20:
            raise ValueError("vignette : trop courte (min 20 caractères)")
        if len(vignette_raw) > 20000:
            raise ValueError("vignette : trop longue (max 20000 caractères)")

        series_format = _optional_str(data.get("seriesFormat"), max_len=10) or "DP"
        if series_format not in {"DP", "KFP"}:
            raise ValueError(f"seriesFormat invalide : {series_format} (attendu 'DP' ou 'KFP')")

        return cls(
            questionIds=question_ids,
            seriesTitle=series_title,
            vignette=vignette_raw,
            seriesFormat=series_format,
        )


@dataclass
class AnnalePatchPayload:
    """
    Payload pour PATCH /api/annales/<id>.
    Tous les champs sont optionnels — seul ce qui est fourni est mis à jour.
    """
    title: Optional[str] = None
    subject: Optional[str] = None
    year: Optional[int] = None
    session: Optional[str] = None
    studyYear: Optional[str] = None
    newId: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Any) -> "AnnalePatchPayload":
        if not isinstance(data, dict):
            raise ValueError("payload doit être un objet JSON")
        # title peut être vide (=None) mais s'il est fourni il doit être non vide
        title = data.get("title")
        if title is not None and not str(title or "").strip():
            raise ValueError("title fourni mais vide")
        year_raw = data.get("year")
        year = None
        if year_raw is not None and year_raw != "":
            try:
                year = int(year_raw)
            except (TypeError, ValueError):
                raise ValueError("year doit être un entier")
        return cls(
            title=_optional_str(title, max_len=200) if "title" in data else None,
            subject=_optional_str(data.get("subject"), max_len=80) if "subject" in data else None,
            year=year if "year" in data else None,
            session=_optional_str(data.get("session"), max_len=20) if "session" in data else None,
            studyYear=_optional_str(data.get("studyYear"), max_len=40) if "studyYear" in data else None,
            newId=_optional_str(data.get("newId"), max_len=80) if "newId" in data else None,
        )

    def has_changes(self) -> bool:
        """True si au moins un champ est fourni à modifier."""
        return any(
            getattr(self, attr) is not None
            for attr in ("title", "subject", "year", "session", "studyYear", "newId")
        )


# ────────────────────────────────────────────────────────────────────
# Reports (signalement de coquilles de parsing par l'utilisateur)
# ────────────────────────────────────────────────────────────────────


REPORT_CATEGORIES = frozenset({
    "vignette-missing",
    "vignette-incomplete",
    "question-text-bad",
    "option-text-bad",
    "correction-incomplete",
    "wrong-answer-flagged",
    "other",
})


@dataclass
class ReportPayload:
    """
    Payload pour POST /api/reports — signalement d'une coquille de parsing
    sur une question publiée. Le report ne mute pas l'annale ; il est juste
    stocké append-only dans data/_reports.jsonl pour traitement ultérieur
    via /admin/corrections.
    """
    annaleId: str
    questionId: str
    category: str
    note: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Any) -> "ReportPayload":
        if not isinstance(data, dict):
            raise ValueError("payload doit être un objet JSON")
        category = _require_str(data.get("category"), "category", max_len=40)
        if category not in REPORT_CATEGORIES:
            raise ValueError(
                f"category invalide : {category} "
                f"(attendu parmi {sorted(REPORT_CATEGORIES)})"
            )
        return cls(
            annaleId=_require_str(data.get("annaleId"), "annaleId", max_len=80),
            questionId=_require_str(data.get("questionId"), "questionId", max_len=80),
            category=category,
            note=_optional_str(data.get("note"), max_len=500),
        )


# ────────────────────────────────────────────────────────────────────
# Question PATCH (édition ciblée d'une question publiée, Niveau 2)
# ────────────────────────────────────────────────────────────────────


# Champs interdits à la modification (cassent la structure / les séries).
QUESTION_PATCH_FORBIDDEN = frozenset({
    "id", "questionType", "format",
    "seriesId", "seriesIndex", "seriesTotal",
    "seriesFormat", "seriesPosition",
})


@dataclass
class QuestionPatchPayload:
    """
    Payload pour PATCH /api/annales/<aid>/questions/<qid>.
    Tous les champs optionnels — seul ce qui est fourni est mis à jour.

    Niveau 2 : textes + bonnes réponses (options[].correct, expectedAnswer).
    PAS de modif structurelle (questionType, seriesId, etc) → 400 si tenté.

    Pour `options`, la longueur et l'ordre doivent être préservés. On accepte
    `{id, text, correct}` par option ; les ids doivent matcher l'existant.
    """
    text: Optional[str] = None
    vignette: Optional[str] = None
    correctionText: Optional[str] = None
    expectedAnswer: Optional[str] = None
    customTitle: Optional[str] = None
    options: Optional[list] = None  # List[dict {id, text, correct}]

    # Trace des clés explicitement fournies dans le payload (pour distinguer
    # "non fourni" vs "fourni à None/vide"). Utile pour idempotence.
    provided_keys: frozenset = field(default_factory=frozenset)

    @classmethod
    def from_dict(cls, data: Any) -> "QuestionPatchPayload":
        if not isinstance(data, dict):
            raise ValueError("payload doit être un objet JSON")

        # Refuser tout champ structurel
        forbidden_used = sorted(set(data.keys()) & QUESTION_PATCH_FORBIDDEN)
        if forbidden_used:
            raise ValueError(
                f"champs interdits à la modification : {forbidden_used} "
                f"(utiliser un re-import ou regroup-to-dp pour modifier la structure)"
            )

        provided = frozenset(k for k in data.keys() if k in {
            "text", "vignette", "correctionText", "expectedAnswer",
            "customTitle", "options",
        })

        # Validation options : list de dict avec id/text/correct
        options = None
        if "options" in data:
            raw_opts = data.get("options")
            if not isinstance(raw_opts, list):
                raise ValueError("options : liste attendue")
            options = []
            for idx, opt in enumerate(raw_opts):
                if not isinstance(opt, dict):
                    raise ValueError(f"options[{idx}] : objet attendu")
                if "id" not in opt:
                    raise ValueError(f"options[{idx}].id manquant")
                opt_id = _require_str(opt.get("id"), f"options[{idx}].id", max_len=8)
                opt_text = _require_str(opt.get("text"), f"options[{idx}].text", max_len=2000)
                options.append({
                    "id": opt_id,
                    "text": opt_text,
                    "correct": bool(opt.get("correct")),
                })

        # Pour les textes, on tolère string vide (= "vider le champ").
        # On garde tel quel après strip, max len appliqué.
        def _opt_text_field(key: str, max_len: int) -> Optional[str]:
            if key not in data:
                return None
            raw = data.get(key)
            if raw is None:
                return ""  # explicite vidage
            if not isinstance(raw, str):
                raise ValueError(f"{key} : string attendue")
            return raw.strip()[:max_len]

        return cls(
            text=_opt_text_field("text", 10000),
            vignette=_opt_text_field("vignette", 20000),
            correctionText=_opt_text_field("correctionText", 10000),
            expectedAnswer=_opt_text_field("expectedAnswer", 2000),
            customTitle=_opt_text_field("customTitle", 300),
            options=options,
            provided_keys=provided,
        )

    def has_changes(self) -> bool:
        return len(self.provided_keys) > 0

    def changes_correct_answers(self) -> bool:
        """True si le payload modifie options[].correct ou expectedAnswer."""
        return ("options" in self.provided_keys) or ("expectedAnswer" in self.provided_keys)
