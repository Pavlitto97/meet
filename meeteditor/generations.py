"""Черга AI-генерацій аватарок: створення, фонове виконання, апрув, регенерація."""
import sys
import threading
import traceback

from . import config, openrouter
from .db import db, log_activity
from .media import avatar_data_url
from .settings import get_setting, get_settings


def _run_generation(gen_id: int) -> None:
    """Виконується у фоновому потоці. Оновлює рядок generations."""
    try:
        with db() as con:
            row = con.execute(
                "SELECT id, participant_id, prompt, model, provider, service_tier "
                "FROM generations WHERE id = ?",
                (gen_id,),
            ).fetchone()
        if not row:
            return
        api_key = get_setting("openrouter_api_key")
        if not api_key:
            raise RuntimeError("OpenRouter API key не задано. Введи його у налаштуваннях.")
        input_url = avatar_data_url(row["participant_id"]) if row["participant_id"] else None
        # Gemini деколи відповідає 200 OK без image (модель «передумала», safety
        # block, або просто промазала). Це транзієнтно — повторюємо до 3 разів
        # перш ніж показати помилку користувачу.
        max_attempts = 3
        last_err: Exception | None = None
        mime = blob = None
        usage: dict = {}
        for attempt in range(max_attempts):
            try:
                resp = openrouter.call_image(
                    api_key,
                    model=row["model"],
                    provider=row["provider"],
                    service_tier=row["service_tier"],
                    prompt=row["prompt"],
                    input_image_data_url=input_url,
                )
                mime, blob = openrouter.extract_image(resp)
                usage = resp.get("usage") or {}
                last_err = None
                break
            except RuntimeError as e:
                last_err = e
                # Ретраїмо лише empty-image випадки. HTTP-помилки (401/404/429)
                # самі не виправляться — фейлимо одразу.
                if "image_url" not in str(e):
                    raise
                sys.stderr.write(f"[gen #{gen_id}] empty image, retry {attempt+1}/{max_attempts}\n")
        if last_err and blob is None:
            raise last_err
        cost = usage.get("cost")
        ptok = usage.get("prompt_tokens")
        otok = usage.get("completion_tokens") or usage.get("output_tokens")
        with db() as con:
            con.execute(
                "UPDATE generations SET status='done', image=?, image_mime=?, "
                "cost_usd=?, prompt_tokens=?, output_tokens=?, "
                "finished_at=CURRENT_TIMESTAMP WHERE id=?",
                (blob, mime, cost, ptok, otok, gen_id),
            )
        log_activity("generation.done", f"#{gen_id} cost={cost}")
    except Exception as e:  # noqa: BLE001 — фіксуємо у статусі
        msg = "".join(traceback.format_exception_only(type(e), e)).strip()
        with db() as con:
            con.execute(
                "UPDATE generations SET status='error', error=?, "
                "finished_at=CURRENT_TIMESTAMP WHERE id=?",
                (msg, gen_id),
            )
        log_activity("generation.error", f"#{gen_id} {msg[:120]}")


def _spawn(gen_id: int) -> None:
    threading.Thread(target=_run_generation, args=(gen_id,), daemon=True).start()


def create_generation(body: dict) -> dict:
    """Ставить нову генерацію у чергу й запускає фоновий потік. Повертає {id} або {error}."""
    pid = body.get("participant_id")
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        try:
            prompt = config.PROMPT_FILE.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            prompt = ""
    if not prompt:
        return {"error": "prompt порожній", "_status": 400}
    s = get_settings(include_secrets=True)
    if not s.get("openrouter_api_key"):
        return {"error": "OpenRouter API key не задано", "_status": 400}
    model = body.get("model") or s.get("gen_model") or config.DEFAULT_GEN_MODEL
    provider = body.get("provider") or s.get("gen_provider") or config.DEFAULT_GEN_PROVIDER
    tier = body.get("service_tier") or s.get("gen_tier") or config.DEFAULT_GEN_TIER
    with db() as con:
        cur = con.execute(
            "INSERT INTO generations(participant_id, prompt, model, provider, service_tier) "
            "VALUES(?,?,?,?,?)",
            (pid, prompt, model, provider, tier),
        )
        gen_id = cur.lastrowid
    log_activity("generation.start", f"#{gen_id} pid={pid}")
    _spawn(gen_id)
    return {"id": gen_id}


def list_generations(participant: str | None = None, status: str | None = None) -> list[dict]:
    # JOIN з participants — щоб у UI показати ім'я в кожній варіант-картці.
    sql = (
        "SELECT g.id, g.participant_id, g.prompt, g.model, g.provider, "
        "g.service_tier, g.status, g.error, "
        "g.image IS NOT NULL AS has_image, g.image_mime, "
        "g.cost_usd, g.prompt_tokens, g.output_tokens, "
        "g.created_at, g.finished_at, "
        "COALESCE(p.custom_name, p.original_name) AS participant_name "
        "FROM generations g "
        "LEFT JOIN participants p ON p.device_id = g.participant_id "
        "WHERE 1=1"
    )
    args: list = []
    if participant:
        sql += " AND g.participant_id = ?"
        args.append(participant)
    if status:
        sql += " AND g.status = ?"
        args.append(status)
    # Групуємо варіанти одного учасника поряд, новіші — зверху.
    sql += " ORDER BY g.participant_id, g.id DESC LIMIT 200"
    with db() as con:
        return [dict(r) for r in con.execute(sql, args)]


def generation_image(gid: int) -> tuple[bytes, str] | None:
    with db() as con:
        row = con.execute(
            "SELECT image, image_mime FROM generations WHERE id = ?", (gid,)
        ).fetchone()
    if not row or not row["image"]:
        return None
    return row["image"], row["image_mime"]


def approve_generation(gid: int, which: str = "start") -> dict:
    """Приймає готову генерацію як аватар учасника. `which` = start|end.

    Кладе ЦІЛУ картинку в одну аватарку (для split-розрізання колажа фронт
    робить approve з двома data-url напряму через PUT /api/participants).
    Видаляє рядок генерації після успіху.
    """
    blob_col = "avatar_end" if which == "end" else "avatar"
    mime_col = "avatar_end_mime" if which == "end" else "avatar_mime"
    with db() as con:
        row = con.execute(
            "SELECT participant_id, image, image_mime, status FROM generations WHERE id = ?",
            (gid,),
        ).fetchone()
        if not row:
            return {"error": "not found", "_status": 404}
        if row["status"] != "done" or not row["image"]:
            return {"error": "генерація ще не готова", "_status": 400}
        pid = row["participant_id"]
        if not pid:
            return {"error": "генерація не привʼязана до учасника", "_status": 400}
        cur = con.execute(
            f"UPDATE participants SET {blob_col}=?, {mime_col}=?, "
            "updated_at=CURRENT_TIMESTAMP WHERE device_id=?",
            (row["image"], row["image_mime"], pid),
        )
        if cur.rowcount == 0:
            return {"error": "учасника не знайдено", "_status": 404}
        con.execute("DELETE FROM generations WHERE id = ?", (gid,))
    log_activity("generation.approve", f"#{gid} → {pid} ({which})")
    return {"ok": True}


def regenerate(gid: int) -> dict:
    """Створює нову генерацію з тими ж параметрами (prompt/model/provider/tier/pid)."""
    with db() as con:
        row = con.execute(
            "SELECT participant_id, prompt, model, provider, service_tier "
            "FROM generations WHERE id = ?",
            (gid,),
        ).fetchone()
        if not row:
            return {"error": "not found", "_status": 404}
        cur = con.execute(
            "INSERT INTO generations(participant_id, prompt, model, provider, service_tier) "
            "VALUES(?,?,?,?,?)",
            (row["participant_id"], row["prompt"], row["model"], row["provider"], row["service_tier"]),
        )
        new_id = cur.lastrowid
    log_activity("generation.regenerate", f"#{gid} → #{new_id}")
    _spawn(new_id)
    return {"id": new_id}


def delete_generation(gid: int) -> dict:
    with db() as con:
        con.execute("DELETE FROM generations WHERE id = ?", (gid,))
    return {"ok": True}


def bulk_delete(scope: str) -> dict:
    """scope: 'error' | 'done' | 'pending' | 'all'."""
    if scope == "all":
        sql, args = "DELETE FROM generations", ()
    elif scope in ("error", "done", "pending"):
        sql, args = "DELETE FROM generations WHERE status = ?", (scope,)
    else:
        return {"error": "scope має бути error|done|pending|all", "_status": 400}
    with db() as con:
        cur = con.execute(sql, args)
        n = cur.rowcount
    log_activity("generation.bulk_delete", f"{scope}: {n}")
    return {"ok": True, "deleted": n}
