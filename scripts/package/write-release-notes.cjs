/* eslint-disable @typescript-eslint/no-require-imports -- Release workflow entry point. */
const fs = require('node:fs')
const path = require('node:path')

const [tag, output] = process.argv.slice(2)
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
if (tag !== `v${version}` || !output)
  throw new Error('Expected the current version tag and output path')
const sections = ['zh', 'en'].map((locale) => {
  const text = fs.readFileSync(path.join('docs', `changelog.${locale}.md`), 'utf8')
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${tag}`)
  if (start < 0) throw new Error(`Missing ${locale} release notes for ${tag}`)
  const next = lines.findIndex((line, index) => index > start && /^## /.test(line))
  const notes = lines
    .slice(start + 1, next < 0 ? undefined : next)
    .join('\n')
    .trim()
  if (!notes) throw new Error(`Empty ${locale} release notes for ${tag}`)
  return `## ${locale === 'zh' ? '简体中文' : 'English'}\n\n${notes}`
})
fs.writeFileSync(output, sections.join('\n\n---\n\n') + '\n')
console.log(`Prepared bilingual release notes for ${tag}`)
