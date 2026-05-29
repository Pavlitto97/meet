"""HTTP-абстракції: Request/Response та BaseHTTPRequestHandler-міст до роутера.

Хендлери з routes.py не торкаються сокета — приймають Request, повертають
Response (або dict → JSON). Це робить їх тестованими і відокремлює транспорт.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from . import config


class Response:
    def __init__(self, status=200, body=b"", content_type="application/octet-stream", headers=None):
        self.status = status
        self.body = body
        self.content_type = content_type
        self.headers = headers or {}

    @classmethod
    def json(cls, payload, status=200, headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        return cls(status, body, "application/json; charset=utf-8", headers)

    @classmethod
    def text(cls, body, status=200, content_type="text/plain; charset=utf-8", headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        return cls(status, body, content_type, headers)


class Request:
    def __init__(self, method, path, query, headers, raw_body):
        self.method = method
        self.path = path
        self.raw_query = query                     # parse_qs result (lists)
        self.query = {k: v[0] for k, v in query.items()}  # перші значення
        self.headers = headers
        self.raw_body = raw_body
        self.params = {}                           # path-параметри з regex
        self._json = None
        self._json_parsed = False

    @property
    def json(self) -> dict:
        if not self._json_parsed:
            self._json_parsed = True
            try:
                self._json = json.loads(self.raw_body) if self.raw_body else {}
            except (json.JSONDecodeError, ValueError):
                self._json = {}
        return self._json

    def q(self, key, default=None):
        return self.query.get(key, default)


def make_handler(dispatch):
    """Будує клас BaseHTTPRequestHandler, що делегує у dispatch(request)."""

    class _Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

        def _process(self):
            u = urlparse(self.path)
            n = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(n) if n else b""
            req = Request(self.command, u.path, parse_qs(u.query), self.headers, raw)
            try:
                resp = dispatch(req)
            except Exception as e:  # noqa: BLE001 — повертаємо 500, не валимо сервер
                import traceback
                sys.stderr.write(traceback.format_exc())
                resp = Response.json({"error": str(e)}, 500)
            self._send(resp)

        do_GET = do_POST = do_PUT = do_DELETE = _process

        def _send(self, resp: Response):
            self.send_response(resp.status)
            self.send_header("Content-Type", resp.content_type)
            self.send_header("Content-Length", str(len(resp.body)))
            for k, v in resp.headers.items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(resp.body)

    return _Handler


def serve_file(path: str) -> Response:
    """Статика з ROOT з безпекою шляхів (не пускає за межі кореня)."""
    if path == "/":
        path = "/editor.html"
    rel = path.lstrip("/")
    target = (config.ROOT / rel).resolve()
    try:
        target.relative_to(config.ROOT.resolve())
    except ValueError:
        return Response.text("forbidden", 403)
    if not target.is_file():
        return Response.text("not found", 404)
    ctype = config.STATIC_CONTENT_TYPES.get(target.suffix.lower(), "application/octet-stream")
    return Response(200, target.read_bytes(), ctype)
