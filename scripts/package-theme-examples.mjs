/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packTheme } from './pack-theme.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'build/themes')
const original = path.join(root, 'docs/themes/nyan-cat')
const read = (name) => JSON.parse(readFileSync(path.join(original, name), 'utf8'))
const assets = read('manifest.json')
const styles = read('theme.json')
// Preserve the legacy source; stage its documented API 2 conversion under build/.
const staging = path.join(output, 'nyan-cat-source')
mkdirSync(staging, { recursive: true })
const manifest = {
  id: 'example.nyan-cat',
  displayName: styles.name,
  version: '1.0.0',
  apiVersion: 2,
  sources: [],
  kind: 'theme',
  theme: { displayName: styles.name }
}
const { resources, slots, text, licenses } = assets
const theme = {
  version: 1,
  colorMode: 'dark',
  accentColor: styles.tokens['--color-primary'],
  headerBackground: styles.tokens['--app-header-bg'],
  footerBackground: styles.tokens['--app-footer-bg'],
  chromeBorder: styles.tokens['--app-chrome-border'],
  background: styles.tokens['--color-bg'],
  tokens: styles.tokens,
  rules: styles.rules,
  assets: { resources, slots, text, licenses }
}
for (const [name, value] of Object.entries({ manifest, theme }))
  writeFileSync(path.join(staging, name + '.json'), JSON.stringify(value, null, 2) + '\n')
for (const name of new Set([...Object.values(resources).map((item) => item.path), ...licenses])) {
  if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(name))
    throw new Error('Invalid legacy theme resource path: ' + name)
  const target = path.join(staging, name)
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(path.join(original, name), target)
}
for (const [directory, destination] of [
  [path.join(root, 'docs/themes/liquid-glass'), path.join(output, 'liquid-glass')],
  [path.join(root, 'docs/themes/gi-columbina'), path.join(output, 'columbina')],
  [staging, path.join(output, 'nyan-cat')]
]) {
  const result = await packTheme(directory, destination)
  console.log(`${path.join(destination, result.filename)} (${result.size} bytes)`)
}
