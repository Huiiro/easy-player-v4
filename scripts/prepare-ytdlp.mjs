import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareYtdlpAsset, resolveYtdlpRelease, selectYtdlpTarget } from './lib/ytdlp.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const release = process.env.EASY_PLAYER_YTDLP_RELEASE
  ? await resolveYtdlpRelease(fetch, process.env.EASY_PLAYER_YTDLP_RELEASE)
  : JSON.parse(await readFile(join(root, 'resources/lib/ytdlp-release.json'), 'utf8'))
const target = selectYtdlpTarget(process.platform, process.arch)
const result = await prepareYtdlpAsset({
  release,
  target,
  destination: join(root, 'resources/lib/yt-dlp', target.directory, target.executable),
  platform: process.platform,
  arch: process.arch
})
console.log(
  `[prepare-ytdlp] ${result.version}, ${result.asset}, SHA-256 verified (${result.cached ? 'matching cache' : 'updated'})`
)
