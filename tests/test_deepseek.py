"""Tests pour core.deepseek (parse_json_object, constantes).

Note : call_deepseek_json n'est pas testable sans mocker urllib ou sans
appeler la vraie API. On teste ici juste le parser de réponse JSON.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.deepseek import (
    DEEPSEEK_CHAT_URL,
    DEEPSEEK_MODELS,
    DEEPSEEK_RETRY_DELAYS,
    DEEPSEEK_MAX_CONCURRENT_CALLS,
    parse_json_object,
)


class TestParseJsonObject(unittest.TestCase):

    def test_valid_json(self):
        result = parse_json_object('{"hello": "world", "num": 42}')
        self.assertEqual(result, {"hello": "world", "num": 42})

    def test_with_markdown_fence(self):
        text = '```json\n{"a": 1}\n```'
        result = parse_json_object(text)
        self.assertEqual(result, {"a": 1})

    def test_with_plain_code_fence(self):
        text = '```\n{"a": 1}\n```'
        result = parse_json_object(text)
        self.assertEqual(result, {"a": 1})

    def test_recovers_from_surrounding_noise(self):
        # DeepSeek prefixed du blabla avant le JSON
        text = 'Voici le résultat : {"questions": [{"id": "q1"}]}\n\nMerci.'
        result = parse_json_object(text)
        self.assertEqual(result, {"questions": [{"id": "q1"}]})

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            parse_json_object("")
        with self.assertRaises(ValueError):
            parse_json_object("   ")

    def test_non_string_raises(self):
        with self.assertRaises(ValueError):
            parse_json_object(None)

    def test_invalid_json_raises(self):
        with self.assertRaises(Exception):
            parse_json_object("definitely not json at all")


class TestConstants(unittest.TestCase):

    def test_url_is_https(self):
        self.assertTrue(DEEPSEEK_CHAT_URL.startswith("https://"))

    def test_models_set(self):
        self.assertIn("deepseek-v4-flash", DEEPSEEK_MODELS)
        self.assertIn("deepseek-v4-pro", DEEPSEEK_MODELS)

    def test_retry_delays_increasing(self):
        # Backoff exponentiel : chaque délai doit être > au précédent
        for i in range(1, len(DEEPSEEK_RETRY_DELAYS)):
            self.assertGreater(DEEPSEEK_RETRY_DELAYS[i], DEEPSEEK_RETRY_DELAYS[i - 1])

    def test_concurrency_reasonable(self):
        # Doit être >0 et raisonnable (<20)
        self.assertGreater(DEEPSEEK_MAX_CONCURRENT_CALLS, 0)
        self.assertLess(DEEPSEEK_MAX_CONCURRENT_CALLS, 20)


if __name__ == "__main__":
    unittest.main()
