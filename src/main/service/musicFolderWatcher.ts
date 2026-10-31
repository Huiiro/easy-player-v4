import fs from 'node:fs'
import path from 'node:path'

interface WatchState {
  watcher?: fs.FSWatcher
  candidates: Map<string, { signature: string; since: number }>
  completed: Map<string, string>
}

interface WatcherOptions {
  extensions: string[]
  ignoredDirectories?: string[]
  knownFiles: () => Set<string>
  importFiles: (root: string, files: string[], active: () => boolean) => Promise<boolean>
  onError: (error: unknown, root: string) => void
  isPaused?: () => boolean
  debounceMs?: number
  stabilityMs?: number
  reconcileMs?: number
}

/** Native notifications trigger discovery; periodic reconciliation repairs missed events. */
export class MusicFolderWatcher {
  private roots = new Map<string, WatchState>()
  private dirty = new Set<string>()
  private timer?: ReturnType<typeof setTimeout>
  private interval?: ReturnType<typeof setInterval>
  private running = false
  private stopped = false

  constructor(private options: WatcherOptions) {}

  setDirectories(directories: string[]): void {
    const unique = new Map<string, string>()
    for (const directory of directories) {
      const resolved = path.resolve(directory)
      unique.set(process.platform === 'win32' ? resolved.toLowerCase() : resolved, resolved)
    }
    const resolved = [...unique.values()]
    const roots = resolved.filter(
      (directory) =>
        !resolved.some((parent) => parent !== directory && this.contains(parent, directory))
    )
    for (const [root, state] of this.roots) {
      if (roots.includes(root)) continue
      state.watcher?.close()
      this.roots.delete(root)
      this.dirty.delete(root)
    }
    for (const root of roots) {
      if (this.roots.has(root)) continue
      this.roots.set(root, { candidates: new Map(), completed: new Map() })
      this.dirty.add(root)
    }
    if (!this.interval && roots.length) {
      this.interval = setInterval(() => {
        for (const root of this.roots.keys()) this.dirty.add(root)
        this.schedule()
      }, this.options.reconcileMs ?? 60_000)
      this.interval.unref()
    }
    this.schedule()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
    clearInterval(this.interval)
    for (const state of this.roots.values()) state.watcher?.close()
    this.roots.clear()
    this.dirty.clear()
  }

  private contains(root: string, file: string): boolean {
    const relative = path.relative(root, file)
    return (
      relative === '' ||
      (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    )
  }

  private schedule(): void {
    // Keep the first deadline so continuous copies cannot starve discovery.
    if (this.stopped || this.timer || !this.dirty.size) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.options.debounceMs ?? 500)
    this.timer.unref()
  }

  private async flush(): Promise<void> {
    if (this.running || this.stopped) return
    if (this.options.isPaused?.()) {
      this.schedule()
      return
    }
    this.running = true
    try {
      for (const root of [...this.dirty]) {
        this.dirty.delete(root)
        const state = this.roots.get(root)
        if (!state) continue
        const active = (): boolean => !this.stopped && this.roots.get(root) === state
        try {
          if (!state.watcher) {
            try {
              state.watcher = fs.watch(root, { recursive: true }, () => {
                if (!active()) return
                this.dirty.add(root)
                this.schedule()
              })
              state.watcher.on('error', (error) => {
                state.watcher?.close()
                state.watcher = undefined
                this.options.onError(error, root)
                // Reattach on the next periodic reconciliation (e.g. a reconnected drive).
              })
            } catch (error) {
              // Unsupported/network filesystems still get periodic discovery.
              this.options.onError(error, root)
            }
          }
          const known = this.options.knownFiles()
          const ready: string[] = []
          const seen = new Set<string>()
          const discover = async (directory: string): Promise<void> => {
            if (!active()) return
            const entries = await fs.promises.readdir(directory, { withFileTypes: true })
            for (const entry of entries) {
              if (!active()) return
              const file = path.join(directory, entry.name)
              if (this.options.ignoredDirectories?.some((ignored) => this.contains(ignored, file)))
                continue
              try {
                if (entry.isDirectory()) await discover(file)
                else if (
                  entry.isFile() &&
                  this.options.extensions.includes(path.extname(file).toLowerCase()) &&
                  !known.has(file)
                ) {
                  const stat = await fs.promises.stat(file)
                  if (!active()) return
                  seen.add(file)
                  const signature = `${stat.size}:${stat.mtimeMs}`
                  if (stat.size === 0) continue
                  if (state.completed.get(file) === signature) continue
                  const candidate = state.candidates.get(file)
                  if (!candidate || candidate.signature !== signature) {
                    state.candidates.set(file, { signature, since: Date.now() })
                    this.dirty.add(root)
                  } else if (
                    stat.size > 0 &&
                    Date.now() - candidate.since >= (this.options.stabilityMs ?? 1500)
                  ) {
                    ready.push(file)
                  } else this.dirty.add(root)
                }
              } catch (error) {
                // A disappearing or unreadable entry must not block sibling folders.
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                  this.options.onError(error, file)
              }
            }
          }
          await discover(root)
          if (!active()) continue
          for (const file of state.candidates.keys())
            if (!seen.has(file)) state.candidates.delete(file)
          for (const file of state.completed.keys())
            if (!seen.has(file)) state.completed.delete(file)
          if (ready.length && this.options.isPaused?.()) this.dirty.add(root)
          else if (ready.length) {
            const signatures = ready.map((file) => state.candidates.get(file)!.signature)
            if (await this.options.importFiles(root, ready, active)) {
              if (!active()) continue
              ready.forEach((file, index) => state.completed.set(file, signatures[index]))
            }
          }
        } catch (error) {
          if (active()) this.options.onError(error, root)
        }
      }
    } finally {
      this.running = false
      this.schedule()
    }
  }
}
