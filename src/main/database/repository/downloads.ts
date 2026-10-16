import { getDatabase } from '../index'
import type { DownloadTask, DownloadTaskInput } from '../types'

export function listDownloadTasks(): DownloadTask[] {
  return getDatabase()
    .prepare(
      'SELECT id, platform, resource_id AS resourceId, sub_id AS subId, title, file_path AS filePath, quality, extra_json, status, progress, created_at AS createdAt FROM download_task ORDER BY id DESC'
    )
    .all()
    .map((row) => ({
      ...(row as Omit<DownloadTask, 'extra'> & { extra_json: string | null }),
      extra: (row as { extra_json: string | null }).extra_json
        ? JSON.parse((row as { extra_json: string }).extra_json)
        : null
    }))
}

export function saveDownloadTask(input: DownloadTaskInput): boolean {
  const result = getDatabase()
    .prepare(
      `INSERT INTO download_task (platform, resource_id, sub_id, title, file_path, quality, extra_json, status, progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(platform, resource_id, sub_id, quality) DO UPDATE SET title = excluded.title, file_path = excluded.file_path, extra_json = excluded.extra_json, status = excluded.status, progress = excluded.progress`
    )
    .run(
      input.platform,
      input.resourceId,
      input.subId ?? '',
      input.title ?? null,
      input.filePath ?? null,
      input.quality ?? '',
      input.extra ? JSON.stringify(input.extra) : null,
      input.status ?? 'pending',
      input.progress ?? 0
    )
  return result.changes > 0
}

export function deleteDownloadTask(id?: number): number {
  return id === undefined
    ? getDatabase().prepare('DELETE FROM download_task').run().changes
    : getDatabase().prepare('DELETE FROM download_task WHERE id = ?').run(id).changes
}

export function hasCompletedDownload(platform: string, resourceId: string, subId = ''): boolean {
  return Boolean(
    getDatabase()
      .prepare(
        "SELECT 1 FROM download_task WHERE platform = ? AND resource_id = ? AND sub_id = ? AND status = 'done'"
      )
      .get(platform, resourceId, subId)
  )
}
