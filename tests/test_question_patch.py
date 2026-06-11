"""Tests pour B2 — QuestionPatchPayload + handler PATCH question."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock

from core.models import QUESTION_PATCH_FORBIDDEN, QuestionPatchPayload
from handlers.annales import (
    _apply_question_patch,
    _count_sessions_with_answer,
    handle_annale_patch_question,
)


# ─────────────────────────────────────────────────────────────────
# QuestionPatchPayload
# ─────────────────────────────────────────────────────────────────


class TestQuestionPatchPayload(unittest.TestCase):

    def test_text_only(self):
        p = QuestionPatchPayload.from_dict({"text": "nouvelle question"})
        self.assertEqual(p.text, "nouvelle question")
        self.assertTrue(p.has_changes())
        self.assertFalse(p.changes_correct_answers())

    def test_options_change_marks_correct_answer(self):
        p = QuestionPatchPayload.from_dict({
            "options": [
                {"id": "A", "text": "opt 1", "correct": True},
                {"id": "B", "text": "opt 2", "correct": False},
            ],
        })
        self.assertTrue(p.changes_correct_answers())

    def test_expected_answer_change_marks_correct_answer(self):
        p = QuestionPatchPayload.from_dict({"expectedAnswer": "42"})
        self.assertTrue(p.changes_correct_answers())

    def test_rejects_forbidden_fields(self):
        for forbidden in QUESTION_PATCH_FORBIDDEN:
            with self.assertRaises(ValueError):
                QuestionPatchPayload.from_dict({forbidden: "anything"})

    def test_rejects_multiple_forbidden_in_message(self):
        with self.assertRaises(ValueError) as ctx:
            QuestionPatchPayload.from_dict({"seriesId": "x", "questionType": "QRU"})
        self.assertIn("seriesId", str(ctx.exception))
        self.assertIn("questionType", str(ctx.exception))

    def test_options_must_have_id_and_text(self):
        with self.assertRaises(ValueError):
            QuestionPatchPayload.from_dict({"options": [{"text": "no id"}]})
        with self.assertRaises(ValueError):
            QuestionPatchPayload.from_dict({"options": [{"id": "A"}]})  # no text

    def test_empty_payload_no_changes(self):
        p = QuestionPatchPayload.from_dict({})
        self.assertFalse(p.has_changes())

    def test_explicit_none_vide_le_champ(self):
        # vignette: None signifie "vider"
        p = QuestionPatchPayload.from_dict({"vignette": None})
        self.assertEqual(p.vignette, "")  # convention interne


# ─────────────────────────────────────────────────────────────────
# _apply_question_patch
# ─────────────────────────────────────────────────────────────────


class TestApplyQuestionPatch(unittest.TestCase):

    def test_change_text(self):
        q = {"id": "q1", "text": "ancien", "questionType": "QRU"}
        patch = QuestionPatchPayload.from_dict({"text": "nouveau"})
        changed, conflicts = _apply_question_patch(q, patch)
        self.assertEqual(conflicts, [])
        self.assertEqual(changed, ["text"])
        self.assertEqual(q["text"], "nouveau")

    def test_change_text_to_empty_is_conflict(self):
        q = {"id": "q1", "text": "ancien"}
        patch = QuestionPatchPayload.from_dict({"text": ""})
        changed, conflicts = _apply_question_patch(q, patch)
        self.assertIn("text ne peut pas etre vide", conflicts[0])
        self.assertEqual(q["text"], "ancien")  # inchangé

    def test_noop_same_value(self):
        q = {"id": "q1", "text": "meme", "vignette": "v"}
        patch = QuestionPatchPayload.from_dict({"text": "meme"})
        changed, _ = _apply_question_patch(q, patch)
        self.assertEqual(changed, [])

    def test_vignette_vidage(self):
        q = {"id": "q1", "text": "ok", "vignette": "ancienne"}
        patch = QuestionPatchPayload.from_dict({"vignette": ""})
        changed, _ = _apply_question_patch(q, patch)
        self.assertEqual(changed, ["vignette"])
        self.assertIsNone(q["vignette"])

    def test_options_change_text_and_correct(self):
        q = {"id": "q1", "text": "ok", "options": [
            {"id": "A", "text": "old1", "correct": True},
            {"id": "B", "text": "old2", "correct": False},
        ]}
        patch = QuestionPatchPayload.from_dict({"options": [
            {"id": "A", "text": "new1", "correct": False},
            {"id": "B", "text": "old2", "correct": True},
        ]})
        changed, conflicts = _apply_question_patch(q, patch)
        self.assertEqual(conflicts, [])
        self.assertEqual(changed, ["options"])
        self.assertEqual(q["options"][0]["text"], "new1")
        self.assertFalse(q["options"][0]["correct"])
        self.assertTrue(q["options"][1]["correct"])

    def test_options_length_mismatch_conflict(self):
        q = {"id": "q1", "text": "ok", "options": [
            {"id": "A", "text": "a", "correct": True},
        ]}
        patch = QuestionPatchPayload.from_dict({"options": [
            {"id": "A", "text": "a", "correct": True},
            {"id": "B", "text": "b", "correct": False},
        ]})
        changed, conflicts = _apply_question_patch(q, patch)
        self.assertEqual(changed, [])
        self.assertTrue(any("longueur" in c for c in conflicts))

    def test_options_id_mismatch_conflict(self):
        q = {"id": "q1", "text": "ok", "options": [
            {"id": "A", "text": "a", "correct": True},
        ]}
        patch = QuestionPatchPayload.from_dict({"options": [
            {"id": "Z", "text": "z", "correct": False},  # id différent
        ]})
        changed, conflicts = _apply_question_patch(q, patch)
        self.assertEqual(changed, [])
        self.assertTrue(any("ids" in c for c in conflicts))

    def test_preserves_other_option_fields(self):
        q = {"id": "q1", "text": "ok", "options": [
            {"id": "A", "text": "old", "correct": False, "image": "img1.png"},
        ]}
        patch = QuestionPatchPayload.from_dict({"options": [
            {"id": "A", "text": "new", "correct": True},
        ]})
        _apply_question_patch(q, patch)
        # `image` doit être préservé
        self.assertEqual(q["options"][0]["image"], "img1.png")
        self.assertEqual(q["options"][0]["text"], "new")


# ─────────────────────────────────────────────────────────────────
# _count_sessions_with_answer
# ─────────────────────────────────────────────────────────────────


class TestCountSessions(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        for f in os.listdir(self.tmpdir):
            os.remove(os.path.join(self.tmpdir, f))
        os.rmdir(self.tmpdir)

    def _write_session(self, name, annale_id, answers):
        path = os.path.join(self.tmpdir, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"annaleId": annale_id, "answers": answers}, fh)

    def test_zero_when_no_sessions(self):
        self.assertEqual(_count_sessions_with_answer(self.tmpdir, "a", "q1"), 0)

    def test_counts_matching(self):
        self._write_session("s1.json", "neuro", {"q1": ["A"], "q2": ["B"]})
        self._write_session("s2.json", "neuro", {"q1": ["A"]})
        self._write_session("s3.json", "neuro", {"q2": ["B"]})  # ne compte pas
        self._write_session("s4.json", "autre", {"q1": ["A"]})  # autre annale
        self.assertEqual(_count_sessions_with_answer(self.tmpdir, "neuro", "q1"), 2)

    def test_skip_empty_answer(self):
        self._write_session("s1.json", "neuro", {"q1": None})
        self._write_session("s2.json", "neuro", {"q1": ""})
        self._write_session("s3.json", "neuro", {"q1": []})
        self.assertEqual(_count_sessions_with_answer(self.tmpdir, "neuro", "q1"), 0)

    def test_dir_doesnt_exist(self):
        self.assertEqual(_count_sessions_with_answer("/nope/nope", "a", "q"), 0)


# ─────────────────────────────────────────────────────────────────
# handle_annale_patch_question (intégration légère)
# ─────────────────────────────────────────────────────────────────


class _FakeHandler:
    """Mimic juste ce dont le handler a besoin : _send_json et _send_error."""
    def __init__(self):
        self.status = None
        self.body = None
        self.error_msg = None
    def _send_json(self, status, body):
        self.status = status
        self.body = body
    def _send_error(self, status, msg):
        self.status = status
        self.error_msg = msg


class TestHandlePatchQuestion(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.sessions_dir = os.path.join(self.tmpdir, "sessions")
        os.makedirs(self.sessions_dir, exist_ok=True)
        self.annales_dir = os.path.join(self.tmpdir, "annales")
        os.makedirs(self.annales_dir, exist_ok=True)

        self.annale = {
            "id": "annale1",
            "title": "Test",
            "questions": [
                {
                    "id": "q1",
                    "questionType": "QRU",
                    "text": "Ancien énoncé",
                    "vignette": "ancienne vignette",
                    "options": [
                        {"id": "A", "text": "opt1", "correct": True},
                        {"id": "B", "text": "opt2", "correct": False},
                    ],
                },
                {
                    "id": "q2",
                    "questionType": "QROC",
                    "text": "Question QROC",
                    "expectedAnswer": "42",
                },
            ],
        }
        self.cache = {"annale1": self.annale}
        self.writes = []
        self.audits = []
        self.backups = []

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _annale_path(self, aid):
        return os.path.join(self.annales_dir, f"{aid}.json")

    def _write_fn(self, path, data):
        self.writes.append((path, data))
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def _audit_fn(self, action, details=None):
        self.audits.append((action, details))

    def _backup_mgr(self):
        mgr = MagicMock()
        def _create():
            self.backups.append({"filename": f"backup-{len(self.backups)}.zip"})
            return self.backups[-1]
        mgr.create = _create
        return mgr

    def _call(self, payload, dry_run=False, qid="q1", aid="annale1",
              backup_done_ref=None):
        if backup_done_ref is None:
            backup_done_ref = {"done": False}
        h = _FakeHandler()
        handle_annale_patch_question(
            h,
            annales_cache=self.cache,
            annale_path=self._annale_path,
            sessions_dir=self.sessions_dir,
            backup_manager=self._backup_mgr(),
            write_json_file_fn=self._write_fn,
            audit_log_fn=self._audit_fn,
            aid=aid,
            qid=qid,
            payload=payload,
            dry_run=dry_run,
            backup_done_ref=backup_done_ref,
        )
        return h

    def test_404_annale_inconnue(self):
        h = self._call({"text": "x"}, aid="ghost")
        self.assertEqual(h.status, 404)

    def test_404_question_inconnue(self):
        h = self._call({"text": "x"}, qid="ghost")
        self.assertEqual(h.status, 404)

    def test_400_payload_vide(self):
        h = self._call({})
        self.assertEqual(h.status, 400)

    def test_400_champ_interdit(self):
        h = self._call({"seriesId": "dp-x"})
        self.assertEqual(h.status, 400)
        self.assertIn("interdits", h.error_msg)

    def test_dry_run_returns_count(self):
        # Préparer 1 session qui a répondu q1
        with open(os.path.join(self.sessions_dir, "s1.json"), "w", encoding="utf-8") as fh:
            json.dump({"annaleId": "annale1", "answers": {"q1": ["A"]}}, fh)
        h = self._call({"options": [
            {"id": "A", "text": "opt1", "correct": False},
            {"id": "B", "text": "opt2", "correct": True},
        ]}, dry_run=True)
        self.assertEqual(h.status, 200)
        self.assertTrue(h.body["dryRun"])
        self.assertEqual(h.body["sessionsImpacted"], 1)
        # Dry-run : annale en cache inchangée
        self.assertTrue(self.annale["questions"][0]["options"][0]["correct"])
        # Pas d'audit ni d'écriture
        self.assertEqual(self.writes, [])
        self.assertEqual(self.audits, [])

    def test_live_change_writes_and_audits(self):
        h = self._call({"text": "Nouveau"})
        self.assertEqual(h.status, 200)
        self.assertTrue(h.body["updated"])
        self.assertEqual(h.body["changedFields"], ["text"])
        # Annale modifiée en place
        self.assertEqual(self.annale["questions"][0]["text"], "Nouveau")
        # 1 écriture
        self.assertEqual(len(self.writes), 1)
        # Audit log présent
        actions = [a[0] for a in self.audits]
        self.assertIn("annale_question_patched", actions)
        # Backup créé
        self.assertEqual(len(self.backups), 1)

    def test_backup_done_once_per_session(self):
        ref = {"done": False}
        self._call({"text": "Nouveau"}, backup_done_ref=ref)
        self.assertTrue(ref["done"])
        # 2e PATCH n'crée pas de nouveau backup
        backups_before = list(self.backups)
        self._call({"text": "Encore plus nouveau"}, backup_done_ref=ref)
        self.assertEqual(len(self.backups), len(backups_before))

    def test_noop_same_value(self):
        h = self._call({"text": "Ancien énoncé"})  # identique
        self.assertEqual(h.status, 200)
        self.assertTrue(h.body["noop"])
        self.assertEqual(self.writes, [])  # rien d'écrit

    def test_conflict_options_length(self):
        h = self._call({"options": [
            {"id": "A", "text": "x", "correct": True},
        ]})
        self.assertEqual(h.status, 409)


if __name__ == "__main__":
    unittest.main()
