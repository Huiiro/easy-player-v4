interface UpdateCandidate {
  state: 'available'
  version: string
}

/** One check per app mount. Disabling invalidates a pending response without retrying. */
export function createAutomaticUpdateChecker(options: {
  check: () => Promise<{ success: boolean; data?: unknown }>
  ignoredVersions: () => readonly string[]
  notify: (version: string) => void
}): { start: () => void; stop: () => void } {
  let started = false
  let active = false

  async function run(): Promise<void> {
    try {
      const result = await options.check()
      if (!active || !result.success) return
      const candidate = result.data as Partial<UpdateCandidate> | null | undefined
      if (
        candidate?.state === 'available' &&
        typeof candidate.version === 'string' &&
        candidate.version.trim() &&
        !options.ignoredVersions().includes(candidate.version)
      ) {
        options.notify(candidate.version)
      }
    } catch {
      // Automatic checks stay quiet on network/IPC failures; manual checks show errors.
    }
  }

  return {
    start() {
      if (started) return
      started = true
      active = true
      void run()
    },
    stop() {
      active = false
    }
  }
}
