"""Tests pour core.storage (IDs, atomic I/O, AuditLog, BackupManager)."""

import json
import os
import sys
import tempfile
import unittest

# Ajoute la racine du projet au path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.storage import (
    SAFE_ID,
    safe_filename,
    safe_slug,
    utc_now_iso,
    read_json_file,
    write_json_file,
    AuditLog,
    BackupManager,
)


class TestSafeID(unittest.TestCase):

    def test_safe_id_accepts_normal(self):
        self.assertTrue(SAFE_ID.match("cardio-2024-s1"))
        self.assertTrue(SAFE_ID.match("q_42"))
        self.assertTrue(SAFE_ID.match("draft_abc123"))

    def test_safe_id_rejects_path_traversal(self):
        self.assertFalse(SAFE_ID.match("../etc/passwd"))
        self.assertFalse(SAFE_ID.match("foo/bar"))
        self.assertFalse(SAFE_ID.match("a b"))  # espace
        self.assertFalse(SAFE_ID.match("café"))  # accent

    def test_safe_id_rejects_too_long(self):
        # Max 80 chars
        self.assertFalse(SAFE_ID.match("a" * 81))
        self.assertTrue(SAFE_ID.match("a" * 80))


class TestSafeFilename(unittest.TestCase):

    def test_valid(self):
        self.assertEqual(safe_filename("image.png"), "image.png")
        self.assertEqual(safe_filename("q1-v2.jpg"), "q1-v2.jpg")

    def test_strips(self):
        self.assertEqual(safe_filename("  file.png  "), "file.png")

    def test_rejects_traversal(self):
        self.assertIsNone(safe_filename("../etc/passwd"))
        self.assertIsNone(safe_filename("foo/bar.png"))
        self.assertIsNone(safe_filename("..\\foo.png"))

    def test_rejects_non_string(self):
        self.assertIsNone(safe_filename(None))
        self.assertIsNone(safe_filename(42))


class TestSafeSlug(unittest.TestCase):

    def test_basic(self):
        self.assertEqual(safe_slug("Hello World"), "hello-world")
        self.assertEqual(safe_slug("Cardiologie 2024 S1"), "cardiologie-2024-s1")

    def test_unicode_strip(self):
        self.assertEqual(safe_slug("Café crème"), "cafe-creme")

    def test_fallback_on_empty(self):
        self.assertEqual(safe_slug(None, fallback="default"), "default")
        self.assertEqual(safe_slug("", fallback="default"), "default")
        self.assertEqual(safe_slug("!!!", fallback="default"), "default")

    def test_max_len(self):
        long_str = "a" * 200
        result = safe_slug(long_str, max_len=80)
        self.assertTrue(len(result) <= 80)


class TestAtomicIO(unittest.TestCase):

    def test_write_then_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "test.json")
            data = {"hello": "world", "num": 42, "list": [1, 2, 3]}
            write_json_file(path, data)
            self.assertEqual(read_json_file(path), data)

    def test_atomic_write_no_partial_file(self):
        """Vérifie qu'un fichier .tmp n'apparaît pas après écriture."""
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "test.json")
            write_json_file(path, {"x": 1})
            self.assertTrue(os.path.isfile(path))
            self.assertFalse(os.path.isfile(path + ".tmp"))


class TestUtcNowIso(unittest.TestCase):

    def test_format(self):
        ts = utc_now_iso()
        self.assertIn("T", ts)
        self.assertTrue(ts.endswith("+00:00") or ts.endswith("Z"))


class TestAuditLog(unittest.TestCase):

    def test_log_appends(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = os.path.join(tmp, "audit.jsonl")
            log = AuditLog()
            log.configure(log_path)
            log.log("test_action", {"foo": "bar"})
            log.log("another", {"value": 42})
            with open(log_path, "r", encoding="utf-8") as fh:
                lines = fh.readlines()
            self.assertEqual(len(lines), 2)
            entry1 = json.loads(lines[0])
            self.assertEqual(entry1["action"], "test_action")
            self.assertEqual(entry1["details"], {"foo": "bar"})
            self.assertIn("at", entry1)

    def test_log_without_configure_is_silent(self):
        """Si non configuré, log() ne plante pas et ne fait rien."""
        log = AuditLog()
        # Pas d'exception
        log.log("test", {"x": 1})


class TestBackupManager(unittest.TestCase):

    def test_create_and_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_root = os.path.join(tmp, "data")
            backups_dir = os.path.join(tmp, "data", "_backups")
            os.makedirs(data_root)
            # Crée quelques fichiers à backuper
            with open(os.path.join(data_root, "test.json"), "w") as fh:
                fh.write('{"x": 1}')
            mgr = BackupManager(data_root, backups_dir, retention=5)
            info = mgr.create()
            self.assertTrue(info["filename"].startswith("backup-"))
            self.assertTrue(info["filename"].endswith(".zip"))
            self.assertGreater(info["sizeBytes"], 0)
            backups = mgr.list_backups()
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0]["filename"], info["filename"])

    def test_delete(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_root = os.path.join(tmp, "data")
            backups_dir = os.path.join(tmp, "data", "_backups")
            os.makedirs(data_root)
            mgr = BackupManager(data_root, backups_dir)
            info = mgr.create()
            self.assertTrue(mgr.delete(info["filename"]))
            self.assertFalse(mgr.delete(info["filename"]))  # Already gone
            self.assertFalse(mgr.delete("invalid-name.zip"))  # Wrong format

    def test_retention(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_root = os.path.join(tmp, "data")
            backups_dir = os.path.join(tmp, "data", "_backups")
            os.makedirs(data_root)
            mgr = BackupManager(data_root, backups_dir, retention=2)
            # Crée 3 backups : le 1er doit être supprimé
            import time
            for _ in range(3):
                mgr.create()
                time.sleep(1.1)  # Pour avoir des timestamps distincts
            backups = mgr.list_backups()
            self.assertLessEqual(len(backups), 2)


if __name__ == "__main__":
    unittest.main()
