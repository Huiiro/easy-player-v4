import { getDatabase } from '../index'

export function getAppSetting(key: string): unknown | null {
  const row = getDatabase().prepare('SELECT value_json FROM app_setting WHERE key = ?').get(key) as
    { value_json?: string } | undefined
  if (!row?.value_json) return null
  try {
    return JSON.parse(row.value_json)
  } catch {
    return null
  }
}

export function setAppSetting(key: string, value: unknown): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_setting (key, value_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`
    )
    .run(key, JSON.stringify(value))
}
