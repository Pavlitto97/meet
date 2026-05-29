"""Мінімальний роутер: реєстрація (метод, regex) → хендлер і диспетчеризація.

Patterns — це regex без якорів; іменовані групи `(?P<id>...)` потрапляють у
req.params. Перший збіг виграє, тож конкретні маршрути реєструй раніше за
catch-all статику.
"""
import re

from .httpio import Response, serve_file

ROUTES = []  # list[(method, compiled_regex, handler)]


def route(method: str, pattern: str):
    rx = re.compile("^" + pattern + "$")
    def deco(fn):
        ROUTES.append((method.upper(), rx, fn))
        return fn
    return deco


def _coerce(result) -> Response:
    """Хендлер може повернути Response або dict. dict із ключем `_status`
    стає HTTP-кодом помилки; решта — JSON 200."""
    if isinstance(result, Response):
        return result
    if isinstance(result, dict):
        status = result.pop("_status", 200)
        return Response.json(result, status)
    if isinstance(result, (list, tuple)):
        return Response.json(result, 200)
    # рядок/None → текст
    return Response.text("" if result is None else str(result))


def dispatch(req) -> Response:
    for method, rx, fn in ROUTES:
        if method != req.method:
            continue
        m = rx.match(req.path)
        if not m:
            continue
        req.params = m.groupdict()
        return _coerce(fn(req))
    # нічого не співпало: GET → статика, інакше 404
    if req.method == "GET":
        return serve_file(req.path)
    return Response.json({"error": "no route"}, 404)
