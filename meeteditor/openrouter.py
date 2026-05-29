"""Клієнт OpenRouter — генерація зображень (chat.completions з modalities) і баланс.

Без зовнішніх залежностей — лише urllib.
"""
import json
import urllib.error
import urllib.request

from . import config
from .media import parse_data_url


def _headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
        # Доброзичливі заголовки рекомендовані доками OpenRouter
        "HTTP-Referer":  "http://localhost:8000/",
        "X-Title":       "Meet Editor",
    }


def fetch_credits(api_key: str) -> dict:
    req = urllib.request.Request(
        config.OPENROUTER_CREDITS_URL, headers=_headers(api_key), method="GET",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def call_image(
    api_key: str,
    *,
    model: str,
    provider: str,
    service_tier: str,
    prompt: str,
    input_image_data_url: str | None,
) -> dict:
    """Викликає chat.completions з modalities=[text,image] і повертає JSON-відповідь."""
    # OpenRouter повертає 404 "No endpoints support modalities text,image" якщо
    # модель не вміє генерувати картинки (напр. google/gemini-3.5-flash —
    # текстова). Раніше відсікаємо з зрозумілою помилкою.
    if "image" not in model.lower():
        raise RuntimeError(
            f"Модель «{model}» не підтримує генерацію зображень. "
            f"Вибери модель з «image» в назві (напр. google/gemini-2.5-flash-image)."
        )
    content: list = [{"type": "text", "text": prompt}]
    if input_image_data_url:
        content.append({"type": "image_url", "image_url": {"url": input_image_data_url}})
    body: dict = {
        "model": model,
        "modalities": ["text", "image"],
        "messages": [{"role": "user", "content": content}],
        # 16:9 → горизонтальний канвас під 2-кадровий side-by-side колаж.
        # Знижує шанс, що модель додасть білий padding навколо вертикальної
        # картинки (бачили це на дефолтному square-output).
        "image_config": {"aspect_ratio": "16:9"},
        # Просимо повернути cost у usage.
        "usage": {"include": True},
    }
    if service_tier and service_tier != "default":
        body["service_tier"] = service_tier
    if provider:
        body["provider"] = {"only": [provider], "allow_fallbacks": False}
    req = urllib.request.Request(
        config.OPENROUTER_URL,
        data=json.dumps(body).encode("utf-8"),
        headers=_headers(api_key),
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # OpenRouter повертає JSON з error.message — піднімаємо його як виключення.
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenRouter HTTP {e.code}: {err_body}") from e


def extract_image(resp: dict) -> tuple[str, bytes]:
    """Витягує першу картинку з відповіді OpenRouter.

    Підтримуємо два формати: message.images=[{image_url:{url:data:...}}] та
    message.content як список з елементом type=image_url.
    """
    choices = resp.get("choices") or []
    if not choices:
        raise RuntimeError("OpenRouter: choices порожній")
    msg = choices[0].get("message", {}) or {}
    # Варіант 1: окремий масив images
    for img in msg.get("images") or []:
        url = (img.get("image_url") or {}).get("url") if isinstance(img, dict) else None
        if url and url.startswith("data:"):
            return parse_data_url(url)
    # Варіант 2: content як масив частин
    content = msg.get("content")
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "image_url":
                url = (part.get("image_url") or {}).get("url")
                if url and url.startswith("data:"):
                    return parse_data_url(url)
    raise RuntimeError("OpenRouter: у відповіді немає image_url у data:base64 форматі")
