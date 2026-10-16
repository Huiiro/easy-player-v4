export interface ChangelogEntry {
  version: string
  notes: string[]
}

/** Read version sections only; draft headings and planning notes are excluded. */
export function parseChangelog(source: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let current: ChangelogEntry | undefined
  for (const line of source.split(/\r?\n/)) {
    const heading = line.trim().match(/^#{1,6}\s+(.+?)\s*#*$/)
    if (heading) {
      const version = heading[1].match(/^v\s*(\d+\.\d+\.\d+)$/i)?.[1]
      current = version ? { version, notes: [] } : undefined
      if (current) entries.push(current)
    } else if (current && line.trim()) {
      current.notes.push(line.trim().replace(/^[-*+]\s+/, ''))
    }
  }
  return entries
    .filter((entry) => entry.notes.length)
    .sort((a, b) => {
      const left = a.version.split('.').map(Number)
      const right = b.version.split('.').map(Number)
      return right[0] - left[0] || right[1] - left[1] || right[2] - left[2]
    })
}
