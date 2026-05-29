"""Точка входу: розбір аргументів, ініціалізація БД, запуск HTTP-сервера."""
import argparse
from http.server import ThreadingHTTPServer

from . import config, state
from .db import init_db
from .httpio import make_handler
from .router import dispatch
from . import routes  # noqa: F401 — імпорт реєструє маршрути через @route


def build_handler():
    return make_handler(dispatch)


def run(port: int | None = None) -> None:
    port = port or config.DEFAULT_PORT
    init_db()
    state.PORT = port
    handler = build_handler()
    print(f"Serving on http://{config.HOST}:{port}  (editor: /editor.html · admin: /admin.html)")
    ThreadingHTTPServer((config.HOST, port), handler).serve_forever()


def main() -> None:
    ap = argparse.ArgumentParser(description="Локальний сервер редактора Meet HTML")
    ap.add_argument("-p", "--port", type=int, default=config.DEFAULT_PORT,
                    help=f"порт (дефолт {config.DEFAULT_PORT}, або змінна PORT)")
    args = ap.parse_args()
    run(args.port)


if __name__ == "__main__":
    main()
