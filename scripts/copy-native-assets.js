// Copy native addon and FFmpeg DLLs from build output to the addon directory
const fs = require('fs')
const path = require('path')

const srcDir = path.join(__dirname, '..', 'build', 'native-addon')
if (process.platform === 'darwin') {
  const nodePath = path.join(srcDir, 'easy_player_native.node')
  const releaseNodePath = path.join(srcDir, 'Release', 'easy_player_native.node')
  if (fs.existsSync(releaseNodePath)) {
    fs.copyFileSync(releaseNodePath, nodePath)
    console.log('[copy-native-assets] Copied:', releaseNodePath, '→', nodePath)
  } else if (!fs.existsSync(nodePath)) {
    console.error('[copy-native-assets] macOS addon not found:', releaseNodePath)
    process.exit(1)
  }
  console.log('[copy-native-assets] macOS addon ready:', nodePath)
  process.exit(0)
}
const ffmpegBin = path.join(__dirname, '..', 'src', 'main', 'native', 'deps', 'ffmpeg')

// Find the FFmpeg directory (glob pattern: ffmpeg-*)
const ffmpegDepsDir = path.join(__dirname, '..', 'src', 'main', 'native', 'deps', 'ffmpeg')
let ffmpegBinDir = ''
try {
  const entries = fs.readdirSync(ffmpegDepsDir)
  const ffmpegDir = entries.find((e) => e.startsWith('ffmpeg-'))
  if (ffmpegDir) {
    ffmpegBinDir = path.join(ffmpegDepsDir, ffmpegDir, 'bin')
  }
} catch {
  // ignore
}

const vcpkgInstalled = process.env.VCPKG_INSTALLED_DIR
  ? path.join(process.env.VCPKG_INSTALLED_DIR, 'x64-windows')
  : process.env.VCPKG_ROOT
    ? path.join(process.env.VCPKG_ROOT, 'installed', 'x64-windows')
    : ''
if ((!ffmpegBinDir || !fs.existsSync(ffmpegBinDir)) && vcpkgInstalled) {
  ffmpegBinDir = path.join(vcpkgInstalled, 'bin')
}
if (!ffmpegBinDir || !fs.existsSync(ffmpegBinDir)) {
  console.error('[copy-native-assets] FFmpeg bin directory not found')
  process.exit(1)
}

// Copy .dll → .node
const dllPath = path.join(srcDir, 'Release', 'easy_player_native.dll')
const nodePath = path.join(srcDir, 'easy_player_native.node')
if (fs.existsSync(dllPath)) {
  fs.copyFileSync(dllPath, nodePath)
  console.log('[copy-native-assets] Copied:', dllPath, '→', nodePath)
} else {
  console.error('[copy-native-assets] DLL not found:', dllPath)
  process.exit(1)
}

// Copy FFmpeg DLLs
const ffmpegPrefixes = ['avcodec-', 'avformat-', 'avutil-', 'swresample-']
const ffmpegEntries = fs.readdirSync(ffmpegBinDir)
for (const prefix of ffmpegPrefixes) {
  const dll = ffmpegEntries.find(
    (entry) => entry.toLowerCase().startsWith(prefix) && entry.toLowerCase().endsWith('.dll')
  )
  if (!dll) {
    console.error('[copy-native-assets] Required FFmpeg DLL not found for prefix:', prefix)
    process.exit(1)
  }
  fs.copyFileSync(path.join(ffmpegBinDir, dll), path.join(srcDir, dll))
  console.log('[copy-native-assets] Copied:', dll)
}

// Copy runtimes from an explicitly configured vcpkg installation when CMake
// did not already put them beside the addon.
const samplerateDll = vcpkgInstalled ? path.join(vcpkgInstalled, 'bin', 'samplerate.dll') : ''
if (fs.existsSync(samplerateDll)) {
  fs.copyFileSync(samplerateDll, path.join(srcDir, 'samplerate.dll'))
  console.log('[copy-native-assets] Copied: samplerate.dll')
} else {
  console.warn('[copy-native-assets] libsamplerate DLL not found, skipping:', samplerateDll)
}

const soundTouchDll = vcpkgInstalled ? path.join(vcpkgInstalled, 'bin', 'SoundTouch.dll') : ''
if (soundTouchDll && fs.existsSync(soundTouchDll)) {
  fs.copyFileSync(soundTouchDll, path.join(srcDir, 'SoundTouch.dll'))
  console.log('[copy-native-assets] Copied: SoundTouch.dll')
}

console.log('[copy-native-assets] Done. Output directory:', srcDir)
