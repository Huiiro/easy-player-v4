/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain JavaScript build runner. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { nativeProfileHash } = createRequire(import.meta.url)('./native-runtime-paths.cjs')
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('This dependency profile targets Windows x64')
const manifestRoot = path.join(root, 'resources/lib/native-deps')
const manifest = JSON.parse(fs.readFileSync(path.join(manifestRoot, 'vcpkg.json'), 'utf8'))
const baseline = manifest['builtin-baseline']
const output = path.join(root, 'build/native-deps')
const vcpkg = process.env.VCPKG_ROOT || path.join(output, 'vcpkg')
const env = {
  ...process.env,
  VCPKG_MAX_CONCURRENCY:
    process.env.VCPKG_MAX_CONCURRENCY || String(Math.min(os.availableParallelism(), 8))
}
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: 'inherit',
    ...options
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`)
  return result.stdout
}
fs.mkdirSync(output, { recursive: true })
if (!fs.existsSync(path.join(vcpkg, '.git'))) {
  if (process.env.VCPKG_ROOT) throw new Error('VCPKG_ROOT must be a vcpkg Git checkout')
  run('git', [
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    'https://github.com/microsoft/vcpkg',
    vcpkg
  ])
  run('git', ['-C', vcpkg, 'fetch', '--depth=1', 'origin', baseline])
  run('git', ['-C', vcpkg, 'checkout', '--detach', baseline])
}
const git = (args) =>
  run('git', ['-C', vcpkg, ...args], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
const commit = spawnSync('git', ['-C', vcpkg, 'cat-file', '-e', `${baseline}^{commit}`], {
  windowsHide: true
})
if (commit.status !== 0) run('git', ['-C', vcpkg, 'fetch', '--depth=1', 'origin', baseline])
const executable = path.join(vcpkg, 'vcpkg.exe')
if (!fs.existsSync(executable))
  run('cmd.exe', ['/d', '/c', path.join(vcpkg, 'bootstrap-vcpkg.bat'), '-disableMetrics'])
const overlay = path.join(output, 'overlay/ffmpeg')
fs.mkdirSync(overlay, { recursive: true })
// Read the port from the pinned commit, not a mutable local vcpkg working tree.
for (const file of git(['ls-tree', '-r', '--name-only', `${baseline}:ports/ffmpeg`])
  .trim()
  .split(/\r?\n/)) {
  const target = path.join(overlay, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, git(['show', `${baseline}:ports/ffmpeg/${file}`]))
}
const portfile = path.join(overlay, 'portfile.cmake')
const anchor = 'message(STATUS "Building Options: ${OPTIONS}")'
const original = fs.readFileSync(portfile, 'utf8')
if (original.split(anchor).length !== 2)
  throw new Error('Pinned FFmpeg port patch location changed')
fs.writeFileSync(
  portfile,
  original.replace(anchor, 'include("${CMAKE_CURRENT_LIST_DIR}/ffmpeg-profile.cmake")\n' + anchor)
)
const profile = fs.readFileSync(path.join(manifestRoot, 'ffmpeg-profile.cmake'))
fs.writeFileSync(path.join(overlay, 'ffmpeg-profile.cmake'), profile)
// Codeberg regenerated its release tarball. Pin the verified 2.4.0 Git commit
// and archive hash instead of depending on the mutable tag archive.
const soundtouch = path.join(output, 'overlay/soundtouch')
const soundtouchLock = JSON.parse(
  fs.readFileSync(path.join(manifestRoot, 'sources.json'), 'utf8')
).soundtouch
fs.mkdirSync(soundtouch, { recursive: true })
for (const file of git(['ls-tree', '-r', '--name-only', `${baseline}:ports/soundtouch`])
  .trim()
  .split(/\r?\n/)) {
  const target = path.join(soundtouch, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, git(['show', `${baseline}:ports/soundtouch/${file}`]))
}
const soundtouchPort = path.join(soundtouch, 'portfile.cmake')
const soundtouchSource = fs.readFileSync(soundtouchPort, 'utf8')
if (!soundtouchSource.includes('REF ${VERSION}') || !/SHA512 [a-f0-9]{128}/.test(soundtouchSource))
  throw new Error('Pinned SoundTouch port patch location changed')
fs.writeFileSync(
  soundtouchPort,
  soundtouchSource
    .replace('REF ${VERSION}', `REF ${soundtouchLock.commit}`)
    .replace(/SHA512 [a-f0-9]{128}/, `SHA512 ${soundtouchLock.sha512}`)
)
console.log(`[native-deps] Pinned vcpkg ${baseline}; audio-only FFmpeg, release x64`)
run(executable, [
  'install',
  `--x-manifest-root=${manifestRoot}`,
  `--x-install-root=${path.join(output, 'installed')}`,
  `--overlay-ports=${path.dirname(overlay)}`,
  `--overlay-triplets=${path.join(manifestRoot, 'triplets')}`,
  '--triplet=x64-windows-audio',
  '--host-triplet=x64-windows',
  `--x-buildtrees-root=${path.join(output, 'buildtrees')}`,
  `--x-packages-root=${path.join(output, 'packages')}`
])
const installed = path.join(output, 'installed/x64-windows-audio')
const info = path.join(installed, 'share/ffmpeg')
fs.writeFileSync(path.join(info, 'easy-player-profile.sha256'), nativeProfileHash(root))
const dlls = fs
  .readdirSync(path.join(installed, 'bin'))
  .filter((name) => /^(avcodec|avformat|avutil|avfilter|swresample)-\d+\.dll$/i.test(name))
  .sort()
for (const prefix of ['avcodec', 'avformat', 'avutil', 'avfilter', 'swresample'])
  if (dlls.filter((name) => name.startsWith(prefix + '-')).length !== 1)
    throw new Error(`Missing audio FFmpeg DLL: ${prefix}`)
const files = Object.fromEntries(
  dlls.map((name) => [
    name,
    createHash('sha256')
      .update(fs.readFileSync(path.join(installed, 'bin', name)))
      .digest('hex')
  ])
)
fs.writeFileSync(
  path.join(info, 'easy-player-runtime.json'),
  JSON.stringify(
    {
      formatVersion: 1,
      profile: 'audio-core',
      baseline,
      profileSha256: nativeProfileHash(root),
      dlls: files
    },
    null,
    2
  )
)
console.log(`[native-deps] Ready: ${installed}`)
