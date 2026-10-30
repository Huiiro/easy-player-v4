/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Shared plain JavaScript build helper. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function nativeDependencyRoot(root) {
  return path.join(root, 'build/native-deps/installed/x64-windows-audio')
}

function nativeProfileHash(root) {
  const config = path.join(root, 'resources/lib/native-deps')
  const hashes = [
    'ffmpeg-profile.cmake',
    'vcpkg.json',
    'triplets/x64-windows-audio.cmake',
    'sources.json'
  ].map((file) =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(config, file)))
      .digest('hex')
  )
  return crypto.createHash('sha256').update(hashes.join('\n')).digest('hex')
}

function nativeRuntimePaths(root, output = path.join(root, 'build/native-addon')) {
  const cache = {}
  const cacheFile = path.join(output, 'CMakeCache.txt')
  if (fs.existsSync(cacheFile)) {
    for (const line of fs.readFileSync(cacheFile, 'utf8').split(/\r?\n/)) {
      const match = /^([^#/:][^:]*):[^=]+=(.*)$/.exec(line)
      if (match) cache[match[1]] = match[2]
    }
  }
  const ffmpegRoot = nativeDependencyRoot(root)
  if (
    cache.FFMPEG_ROOT &&
    path.resolve(cache.FFMPEG_ROOT).toLowerCase() !== path.resolve(ffmpegRoot).toLowerCase()
  ) {
    throw new Error(
      'Native addon still uses another FFmpeg build; run npm run build:native before packaging'
    )
  }
  if (
    cache.AVCODEC_LIB &&
    path.resolve(path.dirname(cache.AVCODEC_LIB)).toLowerCase() !==
      path.resolve(ffmpegRoot, 'lib').toLowerCase()
  ) {
    throw new Error(
      'FFmpeg CMake cache is inconsistent; reconfigure in a clean build directory before packaging'
    )
  }
  const ffmpegManifest = path.join(ffmpegRoot, 'share/ffmpeg/easy-player-runtime.json')
  if (!fs.existsSync(ffmpegManifest))
    throw new Error('Run npm run prepare:native to build the pinned audio dependencies')
  const runtime = JSON.parse(fs.readFileSync(ffmpegManifest, 'utf8'))
  if (
    runtime.formatVersion !== 1 ||
    runtime.profile !== 'audio-core' ||
    runtime.profileSha256 !== nativeProfileHash(root)
  ) {
    throw new Error(
      'Audio dependency profile changed; run npm run prepare:native and rebuild the native addon'
    )
  }
  const ffmpegDlls = Object.keys(runtime.dlls)
  const prefixes = ['avcodec', 'avformat', 'avutil', 'avfilter', 'swresample']
  if (
    ffmpegDlls.length !== prefixes.length ||
    prefixes.some(
      (prefix) =>
        ffmpegDlls.filter((name) => new RegExp(`^${prefix}-\\d+\\.dll$`).test(name)).length !== 1
    )
  ) {
    throw new Error('Unexpected DLL list in the audio FFmpeg manifest')
  }
  for (const name of ffmpegDlls) {
    const file = path.join(ffmpegRoot, 'bin', name)
    if (
      !fs.existsSync(file) ||
      crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== runtime.dlls[name]
    )
      throw new Error(`Audio FFmpeg DLL does not match its manifest: ${name}`)
  }
  return {
    ffmpegRoot,
    ffmpegBin: path.join(ffmpegRoot, 'bin'),
    ffmpegExe: path.join(ffmpegRoot, 'tools/ffmpeg/ffmpeg.exe'),
    ffmpegLicense: path.join(ffmpegRoot, 'share/ffmpeg/copyright'),
    ffmpegDlls,
    ffmpegManifest,
    samplerate: path.join(ffmpegRoot, 'bin/samplerate.dll'),
    soundtouch: path.join(ffmpegRoot, 'bin/SoundTouch.dll')
  }
}

function copyIfDifferent(source, target) {
  if (!source || !fs.existsSync(source))
    throw new Error(`Required native runtime file is missing: ${source}`)
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (!fs.existsSync(target) || hash(source) !== hash(target)) {
    try {
      fs.copyFileSync(source, target)
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) ||
        !fs.existsSync(target)
      )
        throw error
      // Windows allows renaming a mapped DLL while the running process retains
      // its old image. Keep that image outside the package's file patterns.
      const previous = retireRuntimeFile(target)
      try {
        fs.copyFileSync(source, target)
      } catch (copyError) {
        fs.renameSync(previous, target)
        throw copyError
      }
    }
  }
}

function retireRuntimeFile(file) {
  const previous = `${file}.before-audio-${Date.now()}-${process.pid}`
  fs.renameSync(file, previous)
  return previous
}

module.exports = {
  nativeRuntimePaths,
  copyIfDifferent,
  nativeDependencyRoot,
  nativeProfileHash,
  retireRuntimeFile
}
