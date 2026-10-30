import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
if (process.platform === 'win32') {
  const { nativeRuntimePaths } = require('./native-runtime-paths.cjs')
  try {
    nativeRuntimePaths(root, path.join(root, 'build/native-deps/no-addon-cache'))
  } catch {
    const preparation = spawnSync(process.execPath, ['scripts/prepare-native-deps.mjs'], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true
    })
    if (preparation.error) throw preparation.error
    if (preparation.status !== 0) process.exit(preparation.status ?? 1)
  }
}
const electron = require('electron/package.json').version
const extra = process.argv.slice(2)
const outIndex = extra.lastIndexOf('--out')
const output = outIndex >= 0 ? extra[outIndex + 1] : 'build/native-addon'
if (!output) throw new Error('--out needs a directory')
if (outIndex >= 0) extra.splice(outIndex, 2)
const args = [
  'build',
  '--directory',
  'resources/lib',
  '--out',
  output,
  '--runtime',
  'electron',
  '--runtime-version',
  electron,
  '--arch',
  process.platform === 'win32' ? 'x64' : process.arch,
  ...extra
]
console.log(`[build-native] Electron ${electron}, ${process.arch}; output=${output}`)
const configuration = spawnSync(
  process.execPath,
  [require.resolve('cmake-js/bin/cmake-js'), 'configure', ...args.slice(1)],
  { cwd: root, stdio: 'inherit', windowsHide: true }
)
if (configuration.error) throw configuration.error
if (configuration.status !== 0) process.exit(configuration.status ?? 1)
const result = spawnSync(process.execPath, [require.resolve('cmake-js/bin/cmake-js'), ...args], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
const copy = spawnSync(
  process.execPath,
  ['scripts/copy-native-assets.js', output, extra.includes('--debug') ? 'Debug' : 'Release'],
  { cwd: root, stdio: 'inherit', windowsHide: true }
)
if (copy.error) throw copy.error
if (copy.status !== 0) process.exit(copy.status ?? 1)
if (process.platform === 'win32') {
  const ffmpeg = spawnSync(process.execPath, ['scripts/prepare-auto-mix-ffmpeg.mjs', output], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  })
  if (ffmpeg.error) throw ffmpeg.error
  process.exitCode = ffmpeg.status ?? 1
}
