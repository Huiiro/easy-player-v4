/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Cross-platform Mac packaging tests. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  dependencies,
  rpaths,
  resolveSdkLibrary,
  assertArchitecture,
  verifyMacosRuntime
} = require('./macos-runtime.cjs')
const { nativeDependencyRoot, nativeProfileHash } = require('./native-runtime-paths.cjs')
const { nativeTarget } = require('./native-platform.cjs')

const directory = fs.mkdtempSync(path.resolve('build/macos-runtime-test-'))
try {
  assert.equal(nativeTarget('darwin', 'arm64').triplet, 'arm64-osx-audio')
  assert.equal(nativeTarget('darwin', 'x64').cmakeArch, 'x86_64')
  assert.throws(() => nativeTarget('darwin', 'universal'), /single supported/)
  assert.deepEqual(
    dependencies(
      'binary:\n\t@rpath/liba.1.dylib (compatibility version 1.0.0, current version 1.0.0)\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)'
    ),
    ['@rpath/liba.1.dylib', '/usr/lib/libSystem.B.dylib']
  )
  assert.deepEqual(
    rpaths(
      'cmd LC_RPATH\n cmdsize 48\n path @loader_path/../lib (offset 12)\ncmd LC_OTHER\n path ignored (offset 12)'
    ),
    ['@loader_path/../lib']
  )
  const config = path.join(directory, 'resources/lib/native-deps')
  for (const name of [
    'ffmpeg-profile.cmake',
    'ffmpeg-profile-macos.cmake',
    'vcpkg.json',
    'sources.json',
    'triplets/arm64-osx-audio.cmake',
    'macos-dependencies.cmake'
  ]) {
    const target = path.join(config, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.resolve('resources/lib/native-deps', name), target)
  }
  const sdk = nativeDependencyRoot(directory, 'darwin', 'arm64')
  fs.mkdirSync(path.join(sdk, 'lib'), { recursive: true })
  fs.mkdirSync(path.join(sdk, 'share/ffmpeg'), { recursive: true })
  fs.writeFileSync(
    path.join(sdk, 'share/ffmpeg/easy-player-profile.sha256'),
    nativeProfileHash(directory, 'darwin', 'arm64')
  )
  const cmake = spawnSync(
    'cmake',
    ['-DCMAKE_OSX_ARCHITECTURES=arm64', '-P', path.join(config, 'macos-dependencies.cmake')],
    { encoding: 'utf8', windowsHide: true }
  )
  assert.equal(cmake.status, 0, cmake.stderr || cmake.error?.message)
  const library = path.join(sdk, 'lib/liba.1.dylib')
  fs.writeFileSync(library, 'fixture')
  assert.equal(
    resolveSdkLibrary('@rpath/liba.1.dylib', path.join(directory, 'binary'), sdk, []),
    fs.realpathSync(library)
  )
  assert.equal(
    resolveSdkLibrary('@loader_path/deps/liba.1.dylib', path.join(directory, 'binary'), sdk, []),
    fs.realpathSync(library),
    'Rebundling must resolve staged names back to pinned SDK'
  )
  const external = path.join(directory, 'outside.dylib')
  fs.writeFileSync(external, 'external')
  assert.throws(
    () => resolveSdkLibrary(external, path.join(directory, 'binary'), sdk, []),
    /Unpinned external/
  )
  assert.throws(
    () => resolveSdkLibrary('@rpath/missing.dylib', path.join(directory, 'binary'), sdk, []),
    /Unresolved/
  )
  assert.throws(() => assertArchitecture('binary', 'arm64', () => 'x86_64'), /Wrong Mach-O/)
  const runtime = path.join(directory, 'runtime')
  fs.mkdirSync(path.join(runtime, 'deps'), { recursive: true })
  const libraries = [
    'libavcodec.62.dylib',
    'libavformat.62.dylib',
    'libavutil.60.dylib',
    'libavfilter.11.dylib',
    'libswresample.6.dylib',
    'libsamplerate.0.dylib',
    'libSoundTouch.2.dylib'
  ]
  for (const name of [
    'easy_player_native.node',
    'ffmpeg',
    ...libraries.map((name) => 'deps/' + name)
  ])
    fs.writeFileSync(path.join(runtime, name), 'fixture')
  fs.writeFileSync(
    path.join(runtime, 'macos-runtime.json'),
    JSON.stringify({
      formatVersion: 1,
      platform: 'darwin',
      arch: 'arm64',
      profile: 'audio-core',
      profileSha256: nativeProfileHash(directory, 'darwin', 'arm64'),
      libraries
    })
  )
  const execute = (command, args) => {
    if (command === 'lipo') return 'arm64'
    if (command === 'codesign') return ''
    if (args[0] === '-D') return args[1] + ':\n'
    const file = args[1]
    const prefix =
      path.dirname(file) === path.join(runtime, 'deps') ? '@loader_path/' : '@loader_path/deps/'
    return (
      file +
      ':\n\t' +
      prefix +
      libraries[0] +
      ' (compatibility version 1.0.0, current version 1.0.0)'
    )
  }
  verifyMacosRuntime(runtime, 'arm64', directory, execute)
  assert.throws(
    () =>
      verifyMacosRuntime(runtime, 'arm64', directory, (command, args) =>
        command === 'otool' && args[0] === '-L'
          ? 'binary:\n /opt/homebrew/lib/leaked.dylib (compatibility version 1.0.0)'
          : execute(command, args)
      ),
    /Non-bundled/
  )
  fs.unlinkSync(path.join(runtime, 'deps', libraries[0]))
  assert.throws(() => verifyMacosRuntime(runtime, 'arm64', directory, execute), /dylib set differs/)
  console.log(
    'Mac packaging: target mapping, CMake/profile parity, @rpath resolution, rebundling, external/absent dylib rejection, architecture and manifest checks passed'
  )
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
