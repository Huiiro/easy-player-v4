/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain JavaScript build runner. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform === 'darwin' && process.arch === 'arm64') {
  const result = spawnSync('python3', ['scripts/prepare-auto-mix-macos.py'], {
    cwd: root,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Mac Auto Mix preparation failed')
} else if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Auto Mix supports Windows x64 and Mac ARM64 only')
} else {
  const python = path.join(root, 'build/stem-runtime/Scripts/python.exe')
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Auto Mix preparation failed: ${command}`)
  }
  if (!fs.existsSync(python)) {
    run('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'scripts/setup-auto-mix-stems.ps1'
    ])
  }
  run(python, [
    'scripts/prepare-auto-mix-runtime.py',
    '--cache',
    path.join(root, 'build/stem-downloads/model-cache')
  ])
}
