/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Plain JavaScript packaging helper. */
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} = require('node:fs')
const path = require('node:path')
const { nativeDependencyRoot } = require('../lib/native-runtime-paths.cjs')
const nativeLibraries = ['ffmpeg', 'libsamplerate', 'soundtouch', 'zlib']

// These libraries are declared as build dependencies and included in the desktop app bundle.
const bundledDependencies = [
  '@headlessui/vue',
  'cropperjs',
  'gsap',
  'pinia',
  'pinia-plugin-persistedstate',
  'tailwindcss',
  'vue',
  'vue-i18n',
  'vue-router',
  'vue-virtual-scroller',
  'vuedraggable'
]

function licenseFiles(directory, nested = false) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory() && /^(?:licen[cs]es?|license-files)$/i.test(entry.name))
      return licenseFiles(file, true)
    if (
      entry.isFile() &&
      (nested ||
        /^(?:licen[cs]e|copying|copyright|notice|unlicense|third[-_]party[-_]licenses)(?:$|[._-])/i.test(
          entry.name
        ))
    )
      return [file]
    return []
  })
}

function npmNotices(root) {
  const { packages } = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const selected = new Set()
  const notices = new Map()

  function resolvePackage(name, parent) {
    let directory = parent
    while (true) {
      const key = path.posix.join(directory, 'node_modules', name)
      if (packages[key] && existsSync(path.join(root, key, 'package.json'))) return key
      if (!directory || directory === '.') return undefined
      directory = path.posix.dirname(directory)
    }
  }

  const pending = [...Object.keys(packages[''].dependencies), ...bundledDependencies].map(
    (name) => {
      const key = resolvePackage(name, '')
      if (!key) throw new Error(`Missing application dependency for license notices: ${name}`)
      return key
    }
  )
  for (const key of pending) {
    if (selected.has(key)) continue
    selected.add(key)
    const directory = path.join(root, key)
    const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
    const version = `${manifest.name}@${manifest.version}`
    if (!notices.has(version)) {
      const license = packages[key].license || manifest.license?.type || manifest.license
      const files = licenseFiles(directory).sort()
      notices.set(
        version,
        [
          version,
          `License: ${license || 'See upstream distribution'}`,
          `Package: https://www.npmjs.com/package/${manifest.name}/v/${manifest.version}`,
          ...files.map(
            (file) =>
              `\n${path.relative(directory, file).replaceAll('\\', '/')}\n${readFileSync(file, 'utf8').trimEnd()}`
          )
        ].join('\n')
      )
    }

    const entry = packages[key]
    const requiredPeers = Object.keys(entry.peerDependencies || {}).filter(
      (name) => !entry.peerDependenciesMeta?.[name]?.optional
    )
    for (const name of [
      ...Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }),
      ...requiredPeers
    ]) {
      const dependency = resolvePackage(name, key)
      if (dependency && !selected.has(dependency)) pending.push(dependency)
    }
  }

  return [
    'Third-party npm licenses and copyright notices',
    'From the installed packages in the application dependency tree and the bundled libraries.',
    'Package links identify upstream releases and notices when the npm archive has no license file.',
    '',
    [...notices.keys()]
      .sort()
      .map((key) => notices.get(key))
      .join('\n\n' + '-'.repeat(72) + '\n\n'),
    ''
  ].join('\n')
}

function writeThirdPartyNotices(root, platform, arch) {
  const output = path.join(root, 'build/third-party-notices', `${platform}-${arch}`)
  mkdirSync(output, { recursive: true })
  writeFileSync(path.join(output, 'NPM-LICENSES.txt'), npmNotices(root))
  if (platform === 'win32' || platform === 'darwin') {
    const share = path.join(nativeDependencyRoot(root, platform, arch), 'share')
    for (const name of nativeLibraries) {
      copyFileSync(path.join(share, name, 'copyright'), path.join(output, `${name}-LICENSE.txt`))
    }
  }
}

function verifyThirdPartyNotices(resources) {
  const directory = path.join(resources, 'licenses')
  for (const name of [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'NPM-LICENSES.txt',
    'liquid-glass-studio.txt',
    'yt-dlp-THIRD_PARTY_LICENSES.txt',
    'yt-dlp-UNLICENSE.txt',
    ...nativeLibraries.map((name) => `${name}-LICENSE.txt`)
  ]) {
    const file = path.join(directory, name)
    if (!existsSync(file) || !readFileSync(file, 'utf8').trim())
      throw new Error(`Missing packaged license notice: ${name}`)
  }
}

module.exports = { writeThirdPartyNotices, verifyThirdPartyNotices }
