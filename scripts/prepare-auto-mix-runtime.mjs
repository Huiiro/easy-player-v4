/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain JavaScript build runner. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('The embedded Auto Mix runtime is currently prepared for Windows x64 only.')
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
  const source = fs.readFileSync(path.join(root, 'src/main/utils/pathUtils.ts'), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText
  const { getStemCachePath } = await import(
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  )
  run(python, ['scripts/prepare-auto-mix-runtime.py', '--cache', getStemCachePath()])
}
