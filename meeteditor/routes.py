"""Реєстрація всіх HTTP-маршрутів. Кожен хендлер тонкий — делегує у сервісні модулі.

device_id у шляху URL-кодований (encodeURIComponent на фронті), тож unquote-имо.
"""
from urllib.parse import unquote

from . import admin, config, generations, openrouter, participants, render
from .db import db
from .httpio import Response
from .router import route
from .settings import get_settings, update_settings, get_setting


def _did(req) -> str:
    return unquote(req.params["did"])


# ─── Налаштування ─────────────────────────────────────────────────────────────

@route("GET", "/api/settings")
def _get_settings(req):
    return get_settings()


@route("PUT", "/api/settings")
def _put_settings(req):
    return update_settings(req.json)


# ─── Промт + пресети ──────────────────────────────────────────────────────────

@route("GET", "/api/prompt")
def _get_prompt(req):
    try:
        txt = config.PROMPT_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        txt = ""
    return {"prompt": txt}


@route("PUT", "/api/prompt")
def _put_prompt(req):
    config.PROMPT_FILE.write_text(req.json.get("prompt", ""), encoding="utf-8")
    return {"ok": True}


@route("GET", "/api/prompt/presets")
def _list_presets(req):
    return admin.list_presets()


@route("POST", "/api/prompt/presets")
def _save_preset(req):
    return admin.save_preset(req.json.get("name", ""), req.json.get("body", ""))


@route("DELETE", r"/api/prompt/presets/(?P<pid>\d+)")
def _del_preset(req):
    return admin.delete_preset(int(req.params["pid"]))


# ─── Учасники ─────────────────────────────────────────────────────────────────

@route("GET", "/api/participants")
def _list_participants(req):
    return participants.list_participants()


@route("POST", "/api/participants/reorder")
def _reorder(req):
    return participants.reorder(req.json.get("order"))


@route("POST", "/api/participants")
def _create_participant(req):
    return participants.create_participant(req.json)


@route("PUT", r"/api/participants/(?P<did>.+)")
def _update_participant(req):
    return participants.update_participant(_did(req), req.json)


@route("DELETE", r"/api/participants/(?P<did>.+)")
def _delete_participant(req):
    hard = req.q("hard", "0") in ("1", "true")
    return participants.delete_participant(_did(req), hard=hard)


@route("GET", r"/api/avatar/(?P<did>.+)")
def _avatar(req):
    which = req.q("which", "start")
    res = participants.avatar_blob(_did(req), which)
    if not res:
        return Response.text("no avatar", 404)
    blob, mime = res
    return Response(200, blob, mime, {"Cache-Control": "no-store"})


# ─── Рендер ───────────────────────────────────────────────────────────────────

@route("GET", "/api/render")
def _render(req):
    which = req.q("which", "start")
    html = render.render_meet(which).encode("utf-8")
    headers = {}
    if req.q("download"):
        headers["Content-Disposition"] = f'attachment; filename="meet-{which}.html"'
    return Response(200, html, "text/html; charset=utf-8", headers)


# ─── OpenRouter ───────────────────────────────────────────────────────────────

@route("GET", "/api/credits")
def _credits(req):
    api_key = get_setting("openrouter_api_key")
    if not api_key:
        return {"error": "API key не задано", "_status": 400}
    import urllib.error
    try:
        return openrouter.fetch_credits(api_key)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"error": f"HTTP {e.code}: {body}", "_status": e.code}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e), "_status": 500}


# ─── Генерації ────────────────────────────────────────────────────────────────

@route("GET", "/api/generations")
def _list_generations(req):
    return generations.list_generations(req.q("participant_id"), req.q("status"))


@route("POST", "/api/generate")
def _generate(req):
    return generations.create_generation(req.json)


@route("GET", r"/api/generation-image/(?P<gid>\d+)")
def _generation_image(req):
    res = generations.generation_image(int(req.params["gid"]))
    if not res:
        return Response.text("no image", 404)
    blob, mime = res
    return Response(200, blob, mime, {"Cache-Control": "no-store"})


@route("POST", r"/api/generations/(?P<gid>\d+)/approve")
def _approve(req):
    return generations.approve_generation(int(req.params["gid"]), req.json.get("which", "start"))


@route("POST", r"/api/generations/(?P<gid>\d+)/regenerate")
def _regenerate(req):
    return generations.regenerate(int(req.params["gid"]))


@route("POST", "/api/generations/bulk-delete")
def _bulk_delete(req):
    return generations.bulk_delete(req.json.get("scope", ""))


@route("DELETE", r"/api/generations/(?P<gid>\d+)")
def _delete_generation(req):
    return generations.delete_generation(int(req.params["gid"]))


# ─── Адмінка ──────────────────────────────────────────────────────────────────

@route("GET", "/api/admin/stats")
def _admin_stats(req):
    return admin.dashboard_stats()


@route("GET", "/api/admin/system")
def _admin_system(req):
    return admin.system_info()


@route("GET", "/api/admin/db")
def _admin_db(req):
    return admin.db_stats()


@route("POST", "/api/admin/db/vacuum")
def _admin_vacuum(req):
    return admin.vacuum()


@route("POST", "/api/admin/db/reset")
def _admin_reset(req):
    return admin.reset_db(req.json.get("confirm", ""))


@route("POST", "/api/admin/restore-index")
def _admin_restore(req):
    return admin.restore_index(req.json.get("confirm", ""))


@route("GET", "/api/admin/activity")
def _admin_activity(req):
    return admin.list_activity(req.q("limit", 100))


@route("GET", "/api/admin/export")
def _admin_export(req):
    data = admin.export_state()
    resp = Response.json(data)
    if req.q("download"):
        resp.headers["Content-Disposition"] = 'attachment; filename="meet-export.json"'
    return resp


@route("POST", "/api/admin/import")
def _admin_import(req):
    return admin.import_state(req.json)


@route("GET", "/api/admin/backup")
def _admin_backup(req):
    if not config.DB_PATH.is_file():
        return Response.text("no db", 404)
    return Response(
        200, config.DB_PATH.read_bytes(), "application/octet-stream",
        {"Content-Disposition": 'attachment; filename="data.db"', "Cache-Control": "no-store"},
    )
