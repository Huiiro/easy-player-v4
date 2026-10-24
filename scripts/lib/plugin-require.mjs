/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const applicationRoot = fileURLToPath(new URL('../../', import.meta.url))
export const pluginProjectRoot = path.resolve(
  process.env.EASY_PLAYER_PLUGIN_DIR || path.join(applicationRoot, '../easy-player-plugin')
)
export const pluginPath = (relative = '') => path.resolve(pluginProjectRoot, relative)
export const pluginRequire = createRequire(pathToFileURL(pluginPath('package.json')))
export const projectRequire = (importer, name) => createRequire(pathToFileURL(importer))(name)
