import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import Database from 'better-sqlite3'

const databasePath = process.argv[2] ? path.resolve(process.argv[2]) : null
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function loadTypeScript(file) {
  const source = fs.readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const moduleRef = { exports: {} }
  vm.runInNewContext(compiled, { module: moduleRef, exports: moduleRef.exports, Date, Map, Set })
  return moduleRef.exports
}

if (!databasePath || !fs.statSync(databasePath, { throwIfNoEntry: false })?.isFile()) {
  console.error('Usage: migrate-play-history.mjs <path-to-player.db>')
  process.exitCode = 1
} else {
  const databaseSource = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/main/database'
  )
  const { schemaV5 } = loadTypeScript(path.join(databaseSource, 'schema.ts'))
  const { migratePlayHistory } = loadTypeScript(
    path.join(databaseSource, 'playHistoryMigration.ts')
  )
  const backupPath = `${databasePath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const db = new Database(databasePath)
  try {
    db.pragma('foreign_keys = ON')
    const version = db.prepare('SELECT MAX(version) AS version FROM schema_migration').get().version
    if (version !== 4) throw new Error(`Expected schema v4, found v${version ?? 0}`)
    await db.backup(backupPath)
    console.log(`Backup: ${backupPath}`)
    const result = db.transaction(() => {
      db.exec(schemaV5.addSongPreference)
      const migration = migratePlayHistory(db, schemaV5)
      db.prepare('INSERT INTO schema_migration (version) VALUES (5)').run()
      return migration
    })()
    console.log(JSON.stringify(result))
  } finally {
    db.close()
  }
}
