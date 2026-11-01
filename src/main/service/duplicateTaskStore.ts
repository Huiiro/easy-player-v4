import type Database from 'better-sqlite3'
import type {
  DuplicateTaskDetails,
  DuplicateTaskState,
  DuplicateFileReport
} from '../../shared/duplicateFiles'

export interface DuplicateTaskStore {
  load(): DuplicateTaskDetails
  replace(task: DuplicateTaskState): void
  saveState(task: DuplicateTaskState): void
  saveResult(task: DuplicateTaskState, report: DuplicateFileReport): void
  saveSelection(task: DuplicateTaskState, retainedIds: number[]): void
  clear(): void
}

/** Durable task state is independent of disposable analysis caches. */
export function createDuplicateTaskStore(db: Database.Database): DuplicateTaskStore {
  db.exec(`CREATE TABLE IF NOT EXISTS duplicate_scan_task (
    slot INTEGER PRIMARY KEY CHECK(slot = 1), state_json TEXT NOT NULL,
    report_json TEXT, retained_json TEXT
  )`)
  return {
    load(): DuplicateTaskDetails {
      const row = db.prepare('SELECT * FROM duplicate_scan_task WHERE slot = 1').get() as
        { state_json: string; report_json: string | null; retained_json: string | null } | undefined
      if (!row) return { task: null, report: null, retainedIds: null }
      try {
        const task = JSON.parse(row.state_json) as DuplicateTaskState
        if (
          !task ||
          typeof task.id !== 'string' ||
          !['running', 'interrupted', 'paused', 'completed', 'cancelled', 'failed'].includes(
            task.status
          )
        )
          throw new Error('Invalid task')
        task.settling = false
        return {
          task,
          report: row.report_json ? JSON.parse(row.report_json) : null,
          retainedIds: row.retained_json ? JSON.parse(row.retained_json) : null
        }
      } catch {
        return { task: null, report: null, retainedIds: null }
      }
    },
    replace(task): void {
      db.prepare('INSERT OR REPLACE INTO duplicate_scan_task VALUES (1, ?, NULL, NULL)').run(
        JSON.stringify(task)
      )
    },
    saveState(task): void {
      db.prepare('UPDATE duplicate_scan_task SET state_json = ? WHERE slot = 1').run(
        JSON.stringify(task)
      )
    },
    saveResult(task, report): void {
      db.prepare(
        'UPDATE duplicate_scan_task SET state_json = ?, report_json = ?, retained_json = NULL WHERE slot = 1'
      ).run(JSON.stringify(task), JSON.stringify(report))
    },
    saveSelection(task, retainedIds): void {
      db.prepare(
        'UPDATE duplicate_scan_task SET state_json = ?, retained_json = ? WHERE slot = 1'
      ).run(JSON.stringify(task), JSON.stringify(retainedIds))
    },
    clear(): void {
      db.prepare('DELETE FROM duplicate_scan_task WHERE slot = 1').run()
    }
  }
}
