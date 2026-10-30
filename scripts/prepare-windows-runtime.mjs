import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

if (process.platform === 'win32') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const target = path.resolve(root, process.argv[2] || 'build/native-addon')
  const require = createRequire(import.meta.url)
  const { peInfo, isVCRuntime, digest, verifyWindowsRuntime } = require('./windows-runtime.cjs')
  const { copyIfDifferent } = require('./native-runtime-paths.cjs')
  let redist = process.env.EASY_PLAYER_VC_REDIST_DIR
  if (!redist) {
    let installation = process.env.VSINSTALLDIR
    if (!installation) {
      const vswhere = path.join(
        process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)',
        'Microsoft Visual Studio/Installer/vswhere.exe'
      )
      const result = spawnSync(
        vswhere,
        [
          '-latest',
          '-products',
          '*',
          '-requires',
          'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
          '-property',
          'installationPath'
        ],
        { encoding: 'utf8', windowsHide: true }
      )
      if (result.error || result.status !== 0)
        throw new Error(
          'Cannot locate Visual Studio; set EASY_PLAYER_VC_REDIST_DIR to its x64 CRT redistributable directory'
        )
      installation = result.stdout.trim()
    }
    const parent = path.join(installation, 'VC/Redist/MSVC')
    const versions = fs
      .readdirSync(parent)
      .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const version of versions) {
      const x64 = path.join(parent, version, 'x64')
      if (!fs.existsSync(x64)) continue
      const folder = fs.readdirSync(x64).find((name) => /^Microsoft\.VC\d+\.CRT$/.test(name))
      if (folder) {
        redist = path.join(x64, folder)
        break
      }
    }
  }
  if (!redist) throw new Error('Visual Studio x64 CRT redistributable files are missing')
  const sourceNames = new Map(
    fs
      .readdirSync(redist)
      .filter(isVCRuntime)
      .map((name) => [name.toLowerCase(), name])
  )
  const pending = fs
    .readdirSync(target)
    .filter((name) => /\.(dll|node|exe)$/i.test(name) && !isVCRuntime(name))
    .map((name) => path.join(target, name))
  const dlls = {}
  for (let index = 0; index < pending.length; index++) {
    for (const dependency of peInfo(pending[index]).imports.filter(isVCRuntime)) {
      const name = sourceNames.get(dependency.toLowerCase())
      if (!name)
        throw new Error(`Required VC++ DLL missing from Visual Studio redist: ${dependency}`)
      if (dlls[name]) continue
      const source = path.join(redist, name)
      if (peInfo(source).machine !== 0x8664) throw new Error(`VC++ runtime is not x64: ${source}`)
      copyIfDifferent(source, path.join(target, name))
      dlls[name] = digest(source)
      pending.push(source)
    }
  }
  fs.writeFileSync(
    path.join(target, 'msvc-runtime.json'),
    JSON.stringify(
      {
        formatVersion: 1,
        arch: 'x64',
        version: path.basename(path.dirname(path.dirname(redist))),
        dlls
      },
      null,
      2
    )
  )
  verifyWindowsRuntime(target)
  console.log(`[prepare-windows-runtime] Bundled and verified: ${Object.keys(dlls).join(', ')}`)
}
