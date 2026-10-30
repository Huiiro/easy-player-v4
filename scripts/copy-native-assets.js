/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS native build runner. */
// Copy native addon and FFmpeg DLLs from build output to the addon directory
const fs = require('fs')
const path = require('path')
const { nativeRuntimePaths, copyIfDifferent } = require('./native-runtime-paths.cjs')

const root = path.join(__dirname, '..')
const srcDir = path.resolve(root, process.argv[2] || 'build/native-addon')
const configuration = process.argv[3] || 'Release'
if (process.platform === 'darwin') {
  const nodePath = path.join(srcDir, 'easy_player_native.node')
  const releaseNodePath = path.join(srcDir, configuration, 'easy_player_native.node')
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
const runtime = nativeRuntimePaths(root, srcDir)
const ffmpegBinDir = runtime.ffmpegBin
if (!ffmpegBinDir || !fs.existsSync(ffmpegBinDir)) {
  console.error('[copy-native-assets] FFmpeg bin directory not found')
  process.exit(1)
}

// Copy .dll → .node
const dllPath = path.join(srcDir, configuration, 'easy_player_native.dll')
const nodePath = path.join(srcDir, 'easy_player_native.node')
if (fs.existsSync(dllPath)) {
  copyIfDifferent(dllPath, nodePath)
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
  copyIfDifferent(path.join(ffmpegBinDir, dll), path.join(srcDir, dll))
  console.log('[copy-native-assets] Copied:', dll)
}

// Copy runtimes from an explicitly configured vcpkg installation when CMake
// did not already put them beside the addon.
const samplerateDll = runtime.samplerate
if (fs.existsSync(samplerateDll)) {
  copyIfDifferent(samplerateDll, path.join(srcDir, 'samplerate.dll'))
  console.log('[copy-native-assets] Copied: samplerate.dll')
} else {
  console.warn('[copy-native-assets] libsamplerate DLL not found, skipping:', samplerateDll)
}

const soundTouchDll = runtime.soundtouch
if (soundTouchDll && fs.existsSync(soundTouchDll)) {
  copyIfDifferent(soundTouchDll, path.join(srcDir, 'SoundTouch.dll'))
  console.log('[copy-native-assets] Copied: SoundTouch.dll')
}

console.log('[copy-native-assets] Done. Output directory:', srcDir)
