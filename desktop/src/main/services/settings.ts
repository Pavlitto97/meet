/** Читання/запис налаштувань (порт meeteditor/settings.php). Секрети назовні не віддаємо. */
import { all, one, run } from './db';
import { DEFAULT_SETTINGS, SECRET_SETTING_KEYS } from './config';

export function getSettings(includeSecrets = false): Record<string, any> {
  const rows: Record<string, string> = {};
  for (const r of all('SELECT key, value FROM settings')) {
    rows[r.key] = r.value;
  }
  if (includeSecrets) {
    return rows;
  }
  const pub: Record<string, any> = {};
  for (const [k, v] of Object.entries(rows)) {
    if (SECRET_SETTING_KEYS.includes(k)) continue;
    pub[k] = v;
  }
  for (const k of SECRET_SETTING_KEYS) {
    pub[k + '_set'] = !!rows[k];
  }
  return pub;
}

export function getSetting(key: string): string {
  const row = one('SELECT value FROM settings WHERE key = ?', [key]);
  // NULL value → '' (як PHP (string)null), не літерал "null".
  return row && row.value != null ? String(row.value) : '';
}

/** Оновлює дозволені ключі. {ok,updated} або {error,_status}. */
export function updateSettings(body: Record<string, any>): Record<string, any> {
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) {
      updates[k] = v === null || v === undefined ? '' : String(v);
    }
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return { error: 'no allowed keys', _status: 400 };
  }
  for (const [k, v] of Object.entries(updates)) {
    run('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, v]);
  }
  keys.sort();
  return { ok: true, updated: keys };
}
