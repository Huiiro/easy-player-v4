import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pluginPath } from './lib/plugin-require.mjs'

const sdk = new URL('../packages/plugin-sdk/', import.meta.url)
const version = JSON.parse(readFileSync(new URL('package.json', sdk), 'utf8')).version
const files = ['theme-plugin-manifest.schema.json', 'theme.schema.json']
const contents = new Map(files.map((name) => [name, readFileSync(new URL('schemas/' + name, sdk))]))
contents.set(
  'contract.json',
  Buffer.from(
    JSON.stringify(
      {
        sdk: '@easy-player/plugin-sdk',
        sdkVersion: version,
        pluginApiVersion: 2,
        themeFormatVersion: 1,
        sha256: Object.fromEntries(
          [...contents].map(([name, bytes]) => [
            name,
            createHash('sha256').update(bytes).digest('hex')
          ])
        )
      },
      null,
      2
    ) + '\n'
  )
)
if (!process.argv.includes('--check')) mkdirSync(pluginPath('schemas'), { recursive: true })
for (const [name, bytes] of contents) {
  const target = pluginPath('schemas/' + name)
  if (process.argv.includes('--check')) {
    if (!readFileSync(target).equals(bytes)) throw new Error('Theme contract differs: ' + name)
  } else writeFileSync(target, bytes)
}
console.log('Theme authoring schemas match SDK ' + version)
