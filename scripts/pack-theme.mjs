/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pluginPath } from './lib/plugin-require.mjs'

// Keep the packaging implementation and schema checks owned by the plugin project.
export async function packTheme(directory, output) {
  const packer = pluginPath('scripts/pack-theme.mjs')
  if (!existsSync(packer))
    throw new Error(
      'Theme packer not found. Clone Huiiro/easy-player-plugin beside the application, or set EASY_PLAYER_PLUGIN_DIR.'
    )
  const { packTheme: pack } = await import(pathToFileURL(packer).href)
  return pack(path.resolve(directory), path.resolve(output))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2])
    throw new Error('Usage: npm run pack:theme -- <theme-directory> [output-directory]')
  console.log(await packTheme(process.argv[2], process.argv[3] || 'build/themes'))
}
