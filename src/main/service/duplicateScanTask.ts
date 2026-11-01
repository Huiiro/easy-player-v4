import { randomUUID } from 'node:crypto'
import type { DuplicateTaskStore } from './duplicateTaskStore'
import type {
  DuplicateTaskDetails,
  DuplicateTaskState,
  DuplicateScanOptions,
  DuplicateFileReport,
  DuplicateFileProgress
} from '../../shared/duplicateFiles'

interface TaskOptions {
  store: DuplicateTaskStore
  run: (
    options: DuplicateScanOptions,
    progress: (value: DuplicateFileProgress) => void,
    signal: AbortSignal,
    taskId: string
  ) => Promise<DuplicateFileReport>
  changed: (state: DuplicateTaskState | null) => void
}

/** Application-owned task: renderer destruction never owns cancellation or report lifetime. */
export class DuplicateScanTask {
  private details: DuplicateTaskDetails
  private controller?: AbortController
  private pending?: Promise<void>
  private shuttingDown = false
  private stopReason: 'paused' | 'cancelled' | 'interrupted' = 'cancelled'
  private lastPublished = 0
  private lastSaved = 0

  constructor(private options: TaskOptions) {
    this.details = options.store.load()
  }

  get busy(): boolean {
    return !!this.pending
  }
  getState(): DuplicateTaskState | null {
    const state = this.details.task
    return state
      ? {
          ...state,
          options: { ...state.options },
          progress: state.progress ? { ...state.progress } : null
        }
      : null
  }
  getDetails(): DuplicateTaskDetails {
    return {
      task: this.getState(),
      report: this.details.report,
      retainedIds: this.details.retainedIds ? [...this.details.retainedIds] : null
    }
  }

  start(options: DuplicateScanOptions = {}): DuplicateTaskState {
    if (this.busy || this.shuttingDown) throw new Error('busy')
    const now = new Date().toISOString()
    const task: DuplicateTaskState = {
      id: randomUUID(),
      revision: 1,
      status: 'running',
      options: {
        deep: options?.deep === true,
        force: options?.force === true,
        sampleSeconds: options?.sampleSeconds === 120 ? 120 : 60,
        concurrency:
          options?.concurrency === 1 || options?.concurrency === 4 ? options.concurrency : 2
      },
      progress: null,
      recovering: false,
      resumeCount: 0,
      startedAt: now,
      updatedAt: now
    }
    this.options.store.replace(task)
    this.details = { task, report: null, retainedIds: null }
    this.launch()
    return this.getState()!
  }

  resume(): DuplicateTaskState {
    const task = this.details.task
    if (!task || task.status === 'completed') throw new Error('invalid')
    if (this.busy || this.shuttingDown) throw new Error('busy')
    task.resumeProgress = task.progress
    task.recovering = true
    task.resumeCount++
    task.status = 'running'
    task.settling = false
    task.error = undefined
    this.touch()
    this.options.store.saveState(task)
    this.launch()
    return this.getState()!
  }

  restore(): void {
    if (!this.busy && ['running', 'interrupted'].includes(this.details.task?.status ?? ''))
      this.resume()
  }

  pause(): void {
    this.stop('paused')
  }
  cancel(): void {
    this.stop('cancelled')
  }
  shutdown(): void {
    this.shuttingDown = true
    if (this.busy && this.details.task?.status === 'running') this.stop('interrupted')
    else this.controller?.abort()
  }
  async wait(): Promise<void> {
    await this.pending
  }

  saveSelection(reportId: string, retainedIds: number[]): void {
    const { task, report } = this.details
    if (this.shuttingDown || this.busy) throw new Error('busy')
    if (!task || !report || report.id !== reportId) throw new Error('stale')
    if (!Array.isArray(retainedIds) || retainedIds.some((id) => !Number.isSafeInteger(id)))
      throw new Error('invalid')
    const kept = new Set(retainedIds)
    const ids = new Set(report.groups.flatMap((group) => group.files.map((file) => file.id)))
    if (
      [...kept].some((id) => !ids.has(id)) ||
      report.groups.some((group) => !group.files.some((file) => kept.has(file.id)))
    )
      throw new Error('invalid')
    const sorted = [...kept].sort((a, b) => a - b)
    if (JSON.stringify(sorted) === JSON.stringify(this.details.retainedIds)) return
    this.details.retainedIds = sorted
    this.touch()
    this.options.store.saveSelection(task, sorted)
    this.publish(true)
  }

  clearReport(): void {
    if (this.busy || this.shuttingDown) throw new Error('busy')
    this.options.store.clear()
    this.details = { task: null, report: null, retainedIds: null }
    this.options.changed(null)
  }

  private touch(): void {
    if (!this.details.task) return
    this.details.task.revision++
    this.details.task.updatedAt = new Date().toISOString()
  }
  private publish(force = false): void {
    const now = Date.now()
    if (force || now - this.lastPublished >= 100) {
      this.lastPublished = now
      this.options.changed(this.getState())
    }
  }
  private stop(reason: 'paused' | 'cancelled' | 'interrupted'): void {
    const task = this.details.task
    if (!task || task.status === 'completed') return
    this.stopReason = reason
    task.status = reason
    task.settling = this.busy
    this.touch()
    this.options.store.saveState(task)
    this.publish(true)
    this.controller?.abort(new Error(reason))
  }

  private launch(): void {
    const task = this.details.task!
    const controller = new AbortController()
    this.controller = controller
    this.lastPublished = 0
    this.lastSaved = Date.now()
    this.stopReason = 'cancelled'
    this.pending = Promise.resolve().then(() => this.execute(task, controller))
    this.publish(true)
  }
  private async execute(task: DuplicateTaskState, controller: AbortController): Promise<void> {
    try {
      controller.signal.throwIfAborted()
      const report = await this.options.run(
        task.options,
        (progress) => {
          if (this.shuttingDown || controller.signal.aborted) return
          const phaseChanged = task.progress?.phase !== progress.phase
          task.progress = progress
          if (progress.phase !== 'checking') task.recovering = false
          this.touch()
          if (phaseChanged || Date.now() - this.lastSaved >= 1000) {
            this.options.store.saveState(task)
            this.lastSaved = Date.now()
          }
          this.publish(phaseChanged)
        },
        controller.signal,
        task.id
      )
      controller.signal.throwIfAborted()
      if (this.shuttingDown) return
      task.status = 'completed'
      task.recovering = false
      task.reportId = report.id
      task.groupCount = report.groups.length
      this.details.report = report
      this.details.retainedIds = null
      this.touch()
      this.options.store.saveResult(task, report)
    } catch (error) {
      if (this.shuttingDown) return
      task.status = controller.signal.aborted ? this.stopReason : 'failed'
      task.recovering = false
      if (!controller.signal.aborted)
        task.error =
          error instanceof Error && error.message === 'fingerprintMissing'
            ? 'fingerprintMissing'
            : 'failed'
      this.touch()
      this.options.store.saveState(task)
    } finally {
      this.controller = undefined
      this.pending = undefined
      task.settling = false
      if (!this.shuttingDown) {
        this.options.store.saveState(task)
        this.publish(true)
      }
    }
  }
}
