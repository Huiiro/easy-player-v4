import { writeFile } from 'node:fs/promises'
import { resolveYtdlpRelease } from './lib/ytdlp.mjs'

const release = await resolveYtdlpRelease()
await writeFile(
  new URL('../resources/lib/ytdlp-release.json', import.meta.url),
  JSON.stringify(release, null, 2) + '\n'
)
console.log(
  `[update-ytdlp] Locked latest stable release ${release.version} with official SHA-256 for ${Object.keys(release.assets).length} platform assets`
)
