import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pluginPath, pluginProjectRoot } from './lib/plugin-require.mjs'

if (!existsSync(pluginPath('package.json')))
  throw new Error(
    'Clone Huiiro/easy-player-plugin beside the application, or set EASY_PLAYER_PLUGIN_DIR'
  )
if (!process.env.npm_execpath) throw new Error('Run this command through npm')
const result = spawnSync(process.execPath, [process.env.npm_execpath, ...process.argv.slice(2)], {
  cwd: pluginProjectRoot,
  env: process.env,
  stdio: 'inherit'
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
