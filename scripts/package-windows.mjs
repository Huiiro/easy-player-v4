import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const result = spawnSync(
  process.execPath,
  [require.resolve('electron-builder/cli.js'), '--win', '--x64', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_BUILDER_7Z_FILTER: process.env.ELECTRON_BUILDER_7Z_FILTER || 'BCJ',
      ELECTRON_BUILDER_COMPRESSION_LEVEL: process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL || '9'
    }
  }
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
