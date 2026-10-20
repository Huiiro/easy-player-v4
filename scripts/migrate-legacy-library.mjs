import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const script = fileURLToPath(import.meta.url)
const root = resolve(dirname(script), '..')
const args = process.argv.slice(2)
if (args.length !== 1 || args[0] === '--help') {
  console.log(
    'Close Easy Player first. Usage: npm run migrate:legacy -- "/absolute/path/to/player.db"'
  )
  console.log(
    'Supports b0947bc3 and later legacy databases (V5–V8). A SQLite backup is saved beside the database before migration.'
  )
  process.exit(args[0] === '--help' ? 0 : 1)
}
if (!process.versions.electron) {
  const child = spawnSync(require('electron'), [script, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  })
  if (child.error) throw child.error
  process.exit(child.status ?? 1)
}

const cache = join(root, 'node_modules', '.cache')
mkdirSync(cache, { recursive: true })
const temporary = mkdtempSync(join(cache, 'legacy-migration-'))
let db
try {
  const outfile = join(temporary, 'migration.cjs')
  buildSync({
    entryPoints: [join(root, 'scripts/lib/migrate-legacy-library.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external'
  })
  const { needsMigration, migrateLegacyLibrary } = require(outfile)
  const Database = require('better-sqlite3')
  const target = resolve(args[0])
  db = new Database(target, { fileMustExist: true, timeout: 1000 })
  db.pragma('foreign_keys=ON')
  if (!needsMigration(db)) {
    console.log('Already migrated; no changes made.')
  } else {
    const backup = `${target}.backup-${randomUUID()}.db`
    // SQLite's backup API includes committed WAL contents; copying only player.db does not.
    await db.backup(backup)
    console.log(`Backup: ${backup}`)
    migrateLegacyLibrary(db)
    console.log('Migration complete. Start Easy Player to rebuild phonetic search indexes.')
  }
} catch (error) {
  console.error(`Migration failed: ${error.message}`)
  process.exitCode = 1
} finally {
  db?.close()
  rmSync(temporary, { recursive: true, force: true })
}
