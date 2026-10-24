import { pluginProjectRoot } from './lib/plugin-require.mjs'
import { mkdirSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, join, dirname } from 'node:path'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = join(pluginProjectRoot, 'dist')
const output = join(root, 'build/plugins')
mkdirSync(output, { recursive: true })
const files = readdirSync(source).filter((name) => name.endsWith('.epp') || name === 'catalog.json')
for (const name of files) copyFileSync(join(source, name), join(output, name))
mkdirSync(join(root, 'resources/plugins'), { recursive: true })
copyFileSync(join(source, 'catalog.json'), join(root, 'resources/plugins/catalog.json'))
for (const name of readdirSync(output)) {
  if (!/^builtin\.[a-z0-9.-]+\.epp$/.test(name) || files.includes(name)) continue
  const target = resolve(output, name)
  if (dirname(target) !== output) throw new Error('Invalid artifact path')
  unlinkSync(target)
}
console.log('Synced plugin artifacts and application seed catalog')
