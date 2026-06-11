"""
core.deepseek — Client HTTP DeepSeek + retry 429 + semaphore concurrence.

Module zéro-dépendance applicative. Ne connaît rien des annales, prompts, drafts.
Juste : "envoie ce prompt, retourne le JSON parsé".

Issu de Phase 1 de la modularisation.
"""

import json
import re
import threading
import time
from urllib import error as urlerror
from urllib import request as urlrequest


# ────────────────────────────────────────────────────────────────────
# Constantes API
# ────────────────────────────────────────────────────────────────────
DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_MODELS = {"deepseek-v4-pro", "deepseek-v4-flash"}

# Backoff exponentiel sur HTTP 429 (rate-limit dynamique DeepSeek).
# Empirique : DeepSeek revient en quelques secondes à 1 min selon la charge serveur.
DEEPSEEK_RETRY_DELAYS = (5, 15, 45)

# Borne globale : pas plus de N appels DeepSeek simultanés.
# Conservateur car DeepSeek ne publie pas de limite officielle. Voir ADR 005 dans ARCHITECTURE.md.
DEEPSEEK_MAX_CONCURRENT_CALLS = 6
DEEPSEEK_CALL_SEMAPHORE = threading.Semaphore(DEEPSEEK_MAX_CONCURRENT_CALLS)


# ────────────────────────────────────────────────────────────────────
# Parsing JSON tolérant
# ────────────────────────────────────────────────────────────────────


def parse_json_object(text):
    """
    Parse une réponse DeepSeek qui devrait être un objet JSON.
    Tolère les blocs ```json``` markdown et tente de récupérer le premier objet
    en cas d'erreur initiale (workaround pour les réponses bruyantes).
    """
    if not isinstance(text, str) or not text.strip():
        raise ValueError("reponse DeepSeek vide")
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return json.loads(cleaned[start:end + 1])
        raise


# ────────────────────────────────────────────────────────────────────
# Client principal
# ────────────────────────────────────────────────────────────────────


def call_deepseek_json(api_key, model, prompt, max_tokens=24000):
    """
    Appel DeepSeek chat completions en mode JSON object.

    - Retry automatique sur HTTP 429 avec backoff exponentiel (5s, 15s, 45s).
    - Sémaphore global qui borne la concurrence à DEEPSEEK_MAX_CONCURRENT_CALLS.
    - Timeout généreux (900s = 15min) pour les longs prompts QROC.
    - Désactive le mode "thinking" (réflexion lente) pour économiser des tokens.

    Retourne (parsed_content, usage_dict).
    Lève RuntimeError sur tout échec persistant.
    """
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Tu reponds uniquement avec un objet json valide."},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "thinking": {"type": "disabled"},
        "temperature": 0,
        "max_tokens": max_tokens,
        "stream": False,
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    raw = None
    for attempt in range(len(DEEPSEEK_RETRY_DELAYS) + 1):
        req = urlrequest.Request(
            DEEPSEEK_CHAT_URL,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        )
        try:
            with DEEPSEEK_CALL_SEMAPHORE:
                with urlrequest.urlopen(req, timeout=900) as response:
                    raw = response.read().decode("utf-8")
            break
        except urlerror.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            if exc.code == 429 and attempt < len(DEEPSEEK_RETRY_DELAYS):
                time.sleep(DEEPSEEK_RETRY_DELAYS[attempt])
                continue
            raise RuntimeError(f"DeepSeek HTTP {exc.code}: {detail[:1200]}") from exc
        except urlerror.URLError as exc:
            raise RuntimeError(f"appel DeepSeek impossible : {exc.reason}") from exc
    if raw is None:
        raise RuntimeError("appel DeepSeek impossible : aucune reponse")
    payload = json.loads(raw)
    choice = (payload.get("choices") or [{}])[0]
    if choice.get("finish_reason") == "length":
        raise RuntimeError("reponse DeepSeek tronquee")
    content = (choice.get("message") or {}).get("content")
    if not content:
        raise RuntimeError("DeepSeek a renvoye un contenu vide")
    return parse_json_object(content), payload.get("usage")
