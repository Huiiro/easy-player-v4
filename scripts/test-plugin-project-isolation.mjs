import { pluginProjectRoot } from './lib/plugin-require.mjs'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const isolated = mkdtempSync(path.join(tmpdir(), 'easy-player-plugin-project-'))
assert(!isolated.startsWith(root + path.sep))
cpSync(pluginProjectRoot, isolated, {
  recursive: true,
  filter: (filename) => !['node_modules', 'dist', '.git'].includes(path.basename(filename))
})
const env = { ...process.env }
delete env.NODE_PATH
delete env.NODE_OPTIONS
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this check with npm run test:plugin-project')
for (const args of [
  ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
  ['run', 'build'],
  ['test']
]) {
  const result = spawnSync(process.execPath, [npm, ...args], {
    cwd: isolated,
    env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error('Isolated plugin project check failed: ' + args.join(' '))
}
assert.deepEqual(
  JSON.parse(readFileSync(path.join(isolated, 'dist/catalog.json'), 'utf8')),
  JSON.parse(readFileSync(path.join(pluginProjectRoot, 'catalog.json'), 'utf8')),
  'Moving the project must preserve all archive hashes'
)
console.log('Independent project verified outside application checkout: ' + isolated)
