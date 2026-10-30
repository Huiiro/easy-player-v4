import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

if (process.platform === 'win32') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { nativeRuntimePaths, copyIfDifferent, retireRuntimeFile } = createRequire(import.meta.url)(
    './native-runtime-paths.cjs'
  )
  const target = path.resolve(root, process.argv[2] || 'build/native-addon')
  const {
    ffmpegBin: bin,
    ffmpegExe: executable,
    ffmpegLicense: license,
    ffmpegDlls,
    ffmpegManifest
  } = nativeRuntimePaths(root, target)
  if (!fs.existsSync(executable)) throw new Error('Run npm run prepare:native first')
  fs.mkdirSync(target, { recursive: true })
  // Remove only known obsolete FFmpeg DLLs from previous SDK builds.
  for (const name of fs.readdirSync(target)) {
    if (
      /^(avcodec|avformat|avutil|avfilter|avdevice|swresample|swscale|postproc)-\d+\.dll$/i.test(
        name
      ) &&
      !ffmpegDlls.includes(name)
    )
      try {
        fs.unlinkSync(path.join(target, name))
      } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
        retireRuntimeFile(path.join(target, name))
      }
  }
  for (const file of [executable, ...ffmpegDlls.map((name) => path.join(bin, name))])
    copyIfDifferent(file, path.join(target, path.basename(file)))
  copyIfDifferent(license, path.join(target, 'FFmpeg-LICENSE.txt'))
  copyIfDifferent(ffmpegManifest, path.join(target, 'ffmpeg-runtime.json'))
  const crt = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/prepare-windows-runtime.mjs'), target],
    { windowsHide: true, stdio: 'inherit' }
  )
  if (crt.error) throw crt.error
  if (crt.status !== 0) throw new Error('VC++ runtime preparation failed')
  const result = spawnSync(path.join(target, 'ffmpeg.exe'), ['-version'], {
    windowsHide: true,
    stdio: 'ignore'
  })
  if (result.error || result.status !== 0) throw new Error('Bundled FFmpeg validation failed')
  console.log(
    'Bundled FFmpeg prepared; optional Python components are not required for the base installer.'
  )
}
