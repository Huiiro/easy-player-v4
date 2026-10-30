/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- macOS build helpers. */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { nativeDependencyRoot, nativeProfileHash } = require('./native-runtime-paths.cjs')
const { nativeTarget } = require('./native-platform.cjs')

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}
function dependencies(output) {
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim().match(/^(.+?) \(/)?.[1])
    .filter(Boolean)
}
function rpaths(output) {
  const result = []
  let active = false
  for (const line of output.split('\n')) {
    if (/\bcmd LC_/.test(line)) active = /\bcmd LC_RPATH\b/.test(line)
    const match = active && /\bpath (.+) \(offset \d+\)/.exec(line)
    if (match) {
      result.push(match[1])
      active = false
    }
  }
  return result
}
function isSystemLibrary(library) {
  return library.startsWith('/usr/lib/') || library.startsWith('/System/Library/')
}
function minimumMacosVersion(output) {
  const versions = []
  let command = ''
  for (const line of output.split('\n')) {
    const header = /\bcmd (LC_\w+)/.exec(line)
    if (header) command = header[1]
    const pattern =
      command === 'LC_BUILD_VERSION'
        ? /^\s*minos (\d+\.\d+(?:\.\d+)?)/
        : command === 'LC_VERSION_MIN_MACOSX'
          ? /^\s*version (\d+\.\d+(?:\.\d+)?)/
          : null
    const match = pattern?.exec(line)
    if (match) versions.push(match[1])
  }
  return versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
}
function isInside(root, file) {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
function resolveSdkLibrary(reference, source, sdk, searchPaths) {
  const expand = (value) =>
    value
      .replace(/^@loader_path/, path.dirname(source))
      .replace(/^@executable_path/, path.dirname(source))
  const candidates = []
  if (
    reference.startsWith('@loader_path/deps/') ||
    (reference.startsWith('@loader_path/') && path.basename(path.dirname(source)) === 'deps')
  )
    candidates.push(path.join(sdk, 'lib', path.basename(reference)))
  if (reference.startsWith('@rpath/')) {
    const suffix = reference.slice('@rpath/'.length)
    candidates.push(
      ...searchPaths.map((base) => path.join(expand(base), suffix)),
      path.join(sdk, 'lib', suffix),
      path.join(sdk, 'tools/ffmpeg', suffix)
    )
  } else candidates.push(expand(reference))
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || !fs.existsSync(candidate)) continue
    const real = fs.realpathSync(candidate)
    if (!isInside(fs.realpathSync(sdk), real))
      throw new Error(`Unpinned external dylib dependency: ${reference} -> ${real}`)
    return real
  }
  throw new Error(`Unresolved dylib dependency: ${source} -> ${reference}`)
}
function assertArchitecture(file, arch, execute = run) {
  const expected = arch === 'x64' ? 'x86_64' : 'arm64'
  const slices = execute('lipo', ['-archs', file]).trim().split(/\s+/)
  if (!slices.includes(expected))
    throw new Error(
      `Wrong Mach-O architecture: ${file} (${slices.join(', ')}, expected ${expected})`
    )
}
function verifyMacosRuntime(directory, arch, projectRoot, execute = run) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'macos-runtime.json'), 'utf8'))
  if (
    manifest.formatVersion !== 1 ||
    manifest.platform !== 'darwin' ||
    manifest.arch !== arch ||
    manifest.profile !== 'audio-core' ||
    manifest.profileSha256 !== nativeProfileHash(projectRoot, 'darwin', arch)
  )
    throw new Error('Mac runtime does not match the pinned target/profile')
  if (
    !Array.isArray(manifest.libraries) ||
    !manifest.libraries.length ||
    manifest.libraries.some((name) => !/^lib[\w.+-]+\.dylib$/.test(name))
  )
    throw new Error('Invalid Mac dylib manifest')
  for (const prefix of [
    'libavcodec.',
    'libavformat.',
    'libavutil.',
    'libavfilter.',
    'libswresample.',
    'libsamplerate.',
    'libSoundTouch.'
  ])
    if (!manifest.libraries.some((name) => name.startsWith(prefix)))
      throw new Error(`Missing Mac dependency: ${prefix}`)
  const actual = fs
    .readdirSync(path.join(directory, 'deps'))
    .filter((name) => name.endsWith('.dylib'))
    .sort()
  if (actual.join('\n') !== [...manifest.libraries].sort().join('\n'))
    throw new Error('Mac dylib set differs from its manifest')
  const binaries = ['easy_player_native.node', 'ffmpeg', ...actual.map((name) => 'deps/' + name)]
  let bytes = 0
  for (const relative of binaries) {
    const file = path.join(directory, relative)
    assertArchitecture(file, arch, execute)
    execute('codesign', ['--verify', '--strict', file])
    const loadCommands = execute('otool', ['-l', file])
    if (rpaths(loadCommands).length)
      throw new Error(`Unexpected runtime search path remains: ${relative}`)
    const minimum = minimumMacosVersion(loadCommands)
    if (!minimum || minimum.localeCompare('12.0', undefined, { numeric: true }) > 0)
      throw new Error(`Native binary requires a newer macOS than 12.0: ${relative} (${minimum})`)
    const identity = execute('otool', ['-D', file])
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .find(Boolean)
    for (const dependency of dependencies(execute('otool', ['-L', file]))) {
      if (dependency === identity || isSystemLibrary(dependency)) continue
      const prefix = relative.startsWith('deps/') ? '@loader_path/' : '@loader_path/deps/'
      if (!dependency.startsWith(prefix))
        throw new Error(`Non-bundled dependency remains: ${relative} -> ${dependency}`)
      const name = dependency.slice(prefix.length)
      if (!actual.includes(name)) throw new Error(`Missing bundled dependency: ${dependency}`)
    }
    bytes += fs.statSync(file).size
  }
  if (actual.some((name) => /^lib(avdevice|swscale|postproc)\./.test(name)))
    throw new Error('Video/device libraries were included')
  if (bytes > 25 * 1024 ** 2) throw new Error('Mac native audio runtime exceeds 25 MiB')
  return { manifest, bytes }
}
function bundleMacosRuntime(projectRoot, directory, arch = process.arch) {
  const target = nativeTarget('darwin', arch)
  const relative = path.relative(path.join(projectRoot, 'build'), directory)
  if (!relative || !isInside(path.join(projectRoot, 'build'), directory))
    throw new Error('Native staging directory must be inside project build/')
  const sdk = nativeDependencyRoot(projectRoot, 'darwin', arch)
  const sourceManifest = JSON.parse(
    fs.readFileSync(path.join(sdk, 'share/ffmpeg/easy-player-runtime.json'), 'utf8')
  )
  if (
    sourceManifest.profileSha256 !== nativeProfileHash(projectRoot, 'darwin', arch) ||
    sourceManifest.arch !== arch
  )
    throw new Error('Run npm run prepare:native for this Mac architecture')
  const deps = path.join(directory, 'deps')
  const addon = path.join(directory, 'easy_player_native.node')
  const ffmpeg = path.join(sdk, 'tools/ffmpeg/ffmpeg')
  const queue = [
    { source: addon, destination: addon },
    { source: ffmpeg, destination: path.join(directory, 'ffmpeg') }
  ]
  const copied = new Map()
  const names = new Map()
  const edges = new Map()
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const binary = queue[cursor]
    assertArchitecture(binary.source, arch)
    const identity = run('otool', ['-D', binary.source])
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .find(Boolean)
    const search = rpaths(run('otool', ['-l', binary.source]))
    const links = []
    for (const dependency of dependencies(run('otool', ['-L', binary.source]))) {
      if (dependency === identity || isSystemLibrary(dependency)) continue
      const source = resolveSdkLibrary(dependency, binary.source, sdk, search)
      let destination = copied.get(source)
      if (!destination) {
        const name = path.basename(dependency)
        if (names.has(name) && names.get(name) !== source)
          throw new Error(`Dylib basename collision: ${name}`)
        names.set(name, source)
        destination = path.join(deps, name)
        copied.set(source, destination)
        queue.push({ source, destination })
      }
      links.push({ dependency, destination })
    }
    edges.set(binary.destination, links)
  }
  fs.rmSync(deps, { recursive: true, force: true })
  fs.mkdirSync(deps, { recursive: true })
  for (const binary of queue) {
    if (binary.source !== binary.destination) fs.copyFileSync(binary.source, binary.destination)
    fs.chmodSync(binary.destination, 0o755)
  }
  for (const binary of [...queue.slice(2), ...queue.slice(0, 2)]) {
    const inDeps = path.dirname(binary.destination) === deps
    for (const edge of edges.get(binary.destination))
      run('install_name_tool', [
        '-change',
        edge.dependency,
        `${inDeps ? '@loader_path/' : '@loader_path/deps/'}${path.basename(edge.destination)}`,
        binary.destination
      ])
    if (inDeps)
      run('install_name_tool', [
        '-id',
        '@loader_path/' + path.basename(binary.destination),
        binary.destination
      ])
    for (const search of new Set(rpaths(run('otool', ['-l', binary.destination]))))
      run('install_name_tool', ['-delete_rpath', search, binary.destination])
    run('codesign', ['--force', '--sign', '-', '--timestamp=none', binary.destination])
  }
  fs.copyFileSync(
    path.join(sdk, 'share/ffmpeg/copyright'),
    path.join(directory, 'FFmpeg-LICENSE.txt')
  )
  const manifest = {
    formatVersion: 1,
    platform: 'darwin',
    arch,
    profile: 'audio-core',
    profileSha256: sourceManifest.profileSha256,
    minimumSystemVersion: target.deploymentTarget,
    libraries: [...names.keys()].sort()
  }
  fs.writeFileSync(path.join(directory, 'macos-runtime.json'), JSON.stringify(manifest, null, 2))
  const result = verifyMacosRuntime(directory, arch, projectRoot)
  console.log(
    `[macos-runtime] ${arch}: ${manifest.libraries.length} dylibs, ${(result.bytes / 1024 ** 2).toFixed(2)} MiB; all dependencies bundled`
  )
}
module.exports = {
  dependencies,
  rpaths,
  isSystemLibrary,
  resolveSdkLibrary,
  assertArchitecture,
  minimumMacosVersion,
  verifyMacosRuntime,
  bundleMacosRuntime
}
