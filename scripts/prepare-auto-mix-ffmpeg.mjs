/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain JavaScript build runner. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

if (process.platform === 'win32') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  let bin = path.join(root, 'resources/lib/ffmpeg/bin')
  let executable = path.join(bin, 'ffmpeg.exe')
  let license = path.join(root, 'resources/lib/ffmpeg/LICENSE.txt')
  if (!fs.existsSync(executable)) {
    const installed =
      process.env.VCPKG_INSTALLED_DIR ||
      path.join(process.env.VCPKG_ROOT || path.join(root, 'vcpkg'), 'installed')
    bin = path.join(installed, 'x64-windows/bin')
    executable = path.join(installed, 'x64-windows/tools/ffmpeg/ffmpeg.exe')
    license = path.join(installed, 'x64-windows/share/ffmpeg/copyright')
  }
  if (!fs.existsSync(executable))
    throw new Error('Prepare resources/lib/ffmpeg or install vcpkg ffmpeg[ffmpeg] first')
  const target = path.join(root, 'build/native-addon')
  fs.mkdirSync(target, { recursive: true })
  const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  for (const file of [
    executable,
    ...fs
      .readdirSync(bin)
      .filter((name) => name.endsWith('.dll'))
      .map((name) => path.join(bin, name))
  ]) {
    const destination = path.join(target, path.basename(file))
    if (!fs.existsSync(destination) || hash(file) !== hash(destination))
      fs.copyFileSync(file, destination)
  }
  fs.copyFileSync(license, path.join(target, 'FFmpeg-LICENSE.txt'))
  const result = spawnSync(path.join(target, 'ffmpeg.exe'), ['-version'], {
    windowsHide: true,
    stdio: 'ignore'
  })
  if (result.error || result.status !== 0) throw new Error('Bundled FFmpeg validation failed')
  console.log(
    'Bundled FFmpeg prepared; optional Python components are not required for the base installer.'
  )
}
