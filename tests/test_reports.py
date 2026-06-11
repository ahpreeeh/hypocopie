"""Tests pour B1 — ReportStore + ReportPayload."""

from __future__ import annotations

import json
import os
import tempfile
import unittest

from core.models import REPORT_CATEGORIES, ReportPayload
from core.storage import ReportStore


class TestReportPayload(unittest.TestCase):

    def test_minimal_valid(self):
        rp = ReportPayload.from_dict({
            "annaleId": "neuro-2025-s1",
            "questionId": "q12",
            "category": "vignette-missing",
        })
        self.assertEqual(rp.annaleId, "neuro-2025-s1")
        self.assertEqual(rp.questionId, "q12")
        self.assertEqual(rp.category, "vignette-missing")
        self.assertIsNone(rp.note)

    def test_with_note(self):
        rp = ReportPayload.from_dict({
            "annaleId": "a",
            "questionId": "q",
            "category": "vignette-incomplete",
            "note": "il manque les valeurs bio",
        })
        self.assertEqual(rp.note, "il manque les valeurs bio")

    def test_rejects_invalid_category(self):
        with self.assertRaises(ValueError):
            ReportPayload.from_dict({
                "annaleId": "a",
                "questionId": "q",
                "category": "totally-made-up",
            })

    def test_rejects_missing_required(self):
        with self.assertRaises(ValueError):
            ReportPayload.from_dict({"category": "other"})
        with self.assertRaises(ValueError):
            ReportPayload.from_dict({"annaleId": "a", "category": "other"})

    def test_rejects_not_dict(self):
        with self.assertRaises(ValueError):
            ReportPayload.from_dict(None)
        with self.assertRaises(ValueError):
            ReportPayload.from_dict("string")

    def test_truncates_long_note(self):
        long_note = "x" * 1200
        rp = ReportPayload.from_dict({
            "annaleId": "a", "questionId": "q",
            "category": "other", "note": long_note,
        })
        # note tronquée à 500 chars max
        self.assertLessEqual(len(rp.note or ""), 500)

    def test_all_categories_accepted(self):
        for cat in REPORT_CATEGORIES:
            rp = ReportPayload.from_dict({
                "annaleId": "a", "questionId": "q", "category": cat,
            })
            self.assertEqual(rp.category, cat)


class TestReportStore(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.path = os.path.join(self.tmpdir, "reports.jsonl")
        self.store = ReportStore(self.path)

    def tearDown(self):
        if os.path.isfile(self.path):
            os.remove(self.path)
        tmp = f"{self.path}.tmp"
        if os.path.isfile(tmp):
            os.remove(tmp)
        os.rmdir(self.tmpdir)

    def _make_report(self, rid="rep_aaaa", status="open"):
        return {
            "id": rid,
            "annaleId": "a",
            "questionId": "q1",
            "category": "vignette-missing",
            "note": None,
            "status": status,
            "createdAt": "2026-05-24T10:00:00+00:00",
            "resolvedAt": None,
        }

    def test_empty_list(self):
        self.assertEqual(self.store.list(), [])
        self.assertEqual(self.store.list("all"), [])
        self.assertIsNone(self.store.get("rep_xxxx"))

    def test_append_and_list(self):
        self.store.append(self._make_report("rep_1111"))
        self.store.append(self._make_report("rep_2222"))
        opens = self.store.list("open")
        self.assertEqual(len(opens), 2)
        self.assertEqual({r["id"] for r in opens}, {"rep_1111", "rep_2222"})

    def test_filter_resolved(self):
        self.store.append(self._make_report("rep_1111", status="open"))
        self.store.append(self._make_report("rep_2222", status="resolved"))
        self.assertEqual(len(self.store.list("open")), 1)
        self.assertEqual(len(self.store.list("resolved")), 1)
        self.assertEqual(len(self.store.list("all")), 2)

    def test_get_by_id(self):
        self.store.append(self._make_report("rep_target"))
        got = self.store.get("rep_target")
        self.assertEqual(got["id"], "rep_target")
        self.assertIsNone(self.store.get("rep_absent"))

    def test_mark_resolved(self):
        self.store.append(self._make_report("rep_to_close"))
        ok = self.store.mark_resolved("rep_to_close")
        self.assertTrue(ok)
        updated = self.store.get("rep_to_close")
        self.assertEqual(updated["status"], "resolved")
        self.assertIsNotNone(updated["resolvedAt"])

    def test_mark_resolved_idempotent_returns_false(self):
        # Tenter de resolve une 2e fois → False (déjà resolved)
        self.store.append(self._make_report("rep_x", status="open"))
        self.assertTrue(self.store.mark_resolved("rep_x"))
        self.assertFalse(self.store.mark_resolved("rep_x"))

    def test_mark_resolved_unknown_id(self):
        self.assertFalse(self.store.mark_resolved("rep_unknown"))

    def test_tolerates_corrupted_line(self):
        # Écrire manuellement une ligne corrompue + 1 valide
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("not valid json\n")
            fh.write(json.dumps(self._make_report("rep_ok")) + "\n")
        entries = self.store.list("all")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["id"], "rep_ok")


if __name__ == "__main__":
    unittest.main()
