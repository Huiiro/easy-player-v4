/* eslint-disable @typescript-eslint/no-require-imports */
// Build a local test fixture from the established third-party theme, without a plugin repo dependency.
const fs = require('node:fs')
const path = require('node:path')
const AdmZip = require('adm-zip')
module.exports = function nyanFixture(output) {
  const directory = path.resolve('docs/themes/nyan-cat')
  const original = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  const styles = JSON.parse(fs.readFileSync(path.join(directory, 'theme.json'), 'utf8'))
  const manifest = {
    id: 'example.nyan-cat',
    displayName: styles.name,
    version: '1.0.0',
    apiVersion: 2,
    sources: [],
    kind: 'theme',
    theme: { displayName: styles.name }
  }
  const { resources, slots, text, licenses } = original
  const data = {
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
  const files = Object.fromEntries(
    [...Object.values(resources).map((resource) => resource.path), ...licenses].map((file) => [
      file,
      fs.readFileSync(path.join(directory, file))
    ])
  )
  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
  zip.addFile('theme.json', Buffer.from(JSON.stringify(data)))
  for (const [file, bytes] of Object.entries(files)) zip.addFile(file, bytes)
  fs.writeFileSync(output, zip.toBuffer())
  return { manifest, data, files }
}
