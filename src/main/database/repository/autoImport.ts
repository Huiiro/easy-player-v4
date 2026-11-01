import { getDatabase } from '../index'

export function listAutoImportExclusions(): string[] {
  return (
    getDatabase().prepare('SELECT audio FROM library_import_exclusion').all() as Array<{
      audio: string
    }>
  ).map((row) => row.audio)
}

export function isAutoImportExcluded(audio: string): boolean {
  return !!getDatabase()
    .prepare('SELECT 1 FROM library_import_exclusion WHERE audio = ?')
    .get(audio)
}

export function excludeAutoImportFiles(files: string[]): void {
  const insert = getDatabase().prepare(
    'INSERT OR IGNORE INTO library_import_exclusion (audio) VALUES (?)'
  )
  for (const file of files) insert.run(file)
}
