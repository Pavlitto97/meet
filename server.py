#!/usr/bin/env python3
"""Локальний сервер для редактора Meet HTML — точка входу.

Логіка живе у пакеті `meeteditor/` (config, db, render, routes, …). Цей файл
лишається тонким шимом заради звичного запуску:

    python3 server.py            # порт 8000 (або змінна PORT)
    python3 server.py --port 8123

Відкрити:
    http://localhost:8000/editor.html   ← редактор
    http://localhost:8000/admin.html    ← адмін-панель

Без зовнішніх залежностей — лише стандартна бібліотека Python.
"""
from meeteditor.app import main

if __name__ == "__main__":
    main()
