import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const targets = {
  win32: { asset: 'yt-dlp.exe', directory: 'win', executable: 'yt-dlp.exe' },
  darwin: { asset: 'yt-dlp_macos', directory: 'mac', executable: 'yt-dlp' },
  linux: {
    asset: { x64: 'yt-dlp_linux', arm64: 'yt-dlp_linux_aarch64' }[process.arch],
    directory: join('linux', process.arch),
    executable: 'yt-dlp'
  }
}
const target = targets[process.platform]
if (!target?.asset)
  throw new Error(`Unsupported yt-dlp platform: ${process.platform}/${process.arch}`)
const destination = join(root, 'resources', 'lib', 'yt-dlp', target.directory, target.executable)
const existing = await stat(destination).catch((error) => {
  if (error.code !== 'ENOENT') throw error
  return null
})
if (existing?.isFile() && existing.size > 0) {
  if (process.platform !== 'win32') await chmod(destination, 0o755)
  console.log(`[prepare-ytdlp] Using ${destination}`)
} else {
  const release = process.env.EASY_PLAYER_YTDLP_RELEASE || 'latest'
  const releasePath =
    release === 'latest' ? 'latest/download' : `download/${encodeURIComponent(release)}`
  const url = `https://github.com/yt-dlp/yt-dlp/releases/${releasePath}/${target.asset}`
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) })
  if (!response.ok) throw new Error(`yt-dlp download failed: HTTP ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  if (!data.length) throw new Error('yt-dlp download is empty')
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.download`
  await writeFile(temporary, data)
  if (process.platform !== 'win32') await chmod(temporary, 0o755)
  await rename(temporary, destination)
  console.log(`[prepare-ytdlp] Downloaded ${destination}`)
}
