/*
 * Make the macOS N-API module self-contained for electron-builder.
 *
 * Homebrew dylibs use absolute install names. This script follows that
 * dependency graph, copies the non-system libraries beside the addon and
 * rewrites every reference to @loader_path. It intentionally runs only on
 * macOS and leaves the Windows packaging path untouched.
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

if (process.platform !== 'darwin') process.exit(0)

const projectRoot = path.join(__dirname, '..')
const addonPath = path.join(projectRoot, 'build', 'native-addon', 'easy_player_native.node')
const depsDir = path.join(projectRoot, 'build', 'native-addon', 'deps')
const managedPrefixes = ['/opt/homebrew/', '/usr/local/']

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function dependenciesOf(binary) {
  return run('otool', ['-L', binary])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().match(/^(.+?) \(/)?.[1])
    .filter(Boolean)
}

function isManagedLibrary(library) {
  return managedPrefixes.some((prefix) => library.startsWith(prefix)) && fs.existsSync(library)
}

if (!fs.existsSync(addonPath)) {
  throw new Error(`macOS addon not found: ${addonPath}. Run npm run build:native first.`)
}

fs.rmSync(depsDir, { recursive: true, force: true })
fs.mkdirSync(depsDir, { recursive: true })

const queue = [addonPath]
const copied = new Map()
const copiedByRealPath = new Map()
for (let cursor = 0; cursor < queue.length; cursor += 1) {
  const binary = queue[cursor]
  for (const library of dependenciesOf(binary)) {
    if (!isManagedLibrary(library)) continue
    const destination = path.join(depsDir, path.basename(library))
    const realPath = fs.realpathSync(library)
    const existing = copiedByRealPath.get(realPath)
    if (existing) {
      copied.set(library, existing)
      continue
    }
    if (fs.existsSync(destination)) {
      throw new Error(`dylib name collision while bundling: ${library} and ${destination}`)
    }
    fs.copyFileSync(library, destination)
    copied.set(library, destination)
    copiedByRealPath.set(realPath, destination)
    queue.push(destination)
  }
}

// Rewrite references after the entire graph has been collected. The addon
// lives beside deps/, while each copied dylib lives inside deps/ itself.
for (const binary of queue) {
  const isAddon = binary === addonPath
  for (const library of dependenciesOf(binary)) {
    const bundled = copied.get(library)
    if (!bundled) continue
    const replacement = isAddon
      ? `@loader_path/deps/${path.basename(bundled)}`
      : `@loader_path/${path.basename(bundled)}`
    run('install_name_tool', ['-change', library, replacement, binary])
  }
  if (!isAddon) {
    run('install_name_tool', ['-id', `@loader_path/${path.basename(binary)}`, binary])
  }
  // install_name_tool invalidates the Homebrew signature. Electron enables
  // macOS library validation, which otherwise kills the main process while
  // loading the addon with SIGKILL (Code Signature Invalid).
  run('codesign', ['--force', '--sign', '-', '--timestamp=none', binary])
}

console.log(`[bundle-macos-native-deps] Bundled ${copied.size} dylib(s) into ${depsDir}`)
