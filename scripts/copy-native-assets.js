// Copy native addon and FFmpeg DLLs from build output to the addon directory
const fs = require('fs')
const path = require('path')

const srcDir = path.join(__dirname, '..', 'build', 'native-addon')
const ffmpegBin = path.join(
  __dirname,
  '..',
  'src',
  'main',
  'native',
  'deps',
  'ffmpeg'
)

// Find the FFmpeg directory (glob pattern: ffmpeg-*)
const ffmpegDepsDir = path.join(
  __dirname,
  '..',
  'src',
  'main',
  'native',
  'deps',
  'ffmpeg'
)
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

if (!ffmpegBinDir || !fs.existsSync(ffmpegBinDir)) {
  console.error('[copy-native-assets] FFmpeg bin directory not found at:', ffmpegBinDir)
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
const ffmpegDlls = ['avcodec-63.dll', 'avformat-63.dll', 'avutil-61.dll', 'swresample-7.dll']
for (const dll of ffmpegDlls) {
  const src = path.join(ffmpegBinDir, dll)
  const dst = path.join(srcDir, dll)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst)
    console.log('[copy-native-assets] Copied:', dll)
  } else {
    console.warn('[copy-native-assets] DLL not found, skipping:', src)
  }
}

console.log('[copy-native-assets] Done. Output directory:', srcDir)
