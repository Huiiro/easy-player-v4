import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') throw new Error('Build the macOS package on a macOS runner')
const args = process.argv.slice(2)
if (args.includes('--universal'))
  throw new Error(
    'Universal requires two verified native slices; use the Apple Silicon --arm64 build first'
  )
const arch = args.includes('--x64') ? 'x64' : 'arm64'
if (process.arch !== arch)
  throw new Error(
    `Use native ${arch} Node.js so SQLite/Sharp and the audio engine share one architecture`
  )
const require = createRequire(import.meta.url)
const env = { ...process.env, EASY_PLAYER_NATIVE_ARCH: arch, MACOSX_DEPLOYMENT_TARGET: '12.0' }
for (const script of ['prepare:ytdlp', 'prepare:fpcalc', 'build:native', 'build']) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', script], {
    env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const result = spawnSync(
  process.execPath,
  [
    require.resolve('electron-builder/cli.js'),
    '--mac',
    `--${arch}`,
    ...args.filter((arg) => !['--arm64', '--x64'].includes(arg))
  ],
  { env, stdio: 'inherit' }
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
const verify = spawnSync(
  process.execPath,
  [
    'scripts/verify-macos-package.cjs',
    path.resolve('dist', arch === 'arm64' ? 'mac-arm64' : 'mac', 'EasyPlayer.app'),
    arch
  ],
  { env, stdio: 'inherit' }
)
if (verify.error) throw verify.error
process.exitCode = verify.status ?? 1
