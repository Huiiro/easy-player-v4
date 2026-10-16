import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const exports = {}
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/renderer/src/utils/changelog.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  { exports }
)
const { parseChangelog } = exports
const fixture = [
  'Unversioned notes',
  '#### v 3.0.9',
  'Older fix',
  '#### v3.0.16 ?',
  'Unconfirmed draft',
  '#### v3.0.10',
  '- Newer fix',
  '#### v3.2.0',
  '* Current feature',
  '#### plan',
  'Private planning notes',
  '#### v3.1.0'
].join('\r\n')
const entries = parseChangelog(fixture)
assert.deepEqual(
  Array.from(entries, (entry) => entry.version),
  ['3.2.0', '3.0.10', '3.0.9']
)
assert.deepEqual(Array.from(entries[0].notes), ['Current feature'])
assert.deepEqual(Array.from(entries[1].notes), ['Newer fix'])
assert.equal(parseChangelog('').length, 0)
assert.equal(parseChangelog('#### plan\nNot a release').length, 0)
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const documents = ['zh', 'en'].map((locale) => {
  const entries = parseChangelog(readFileSync(`docs/changelog.${locale}.md`, 'utf8'))
  assert.ok(
    entries.some((entry) => entry.version === version),
    `${locale}: Current version must have release notes`
  )
  assert.ok(entries.length > 1, `${locale}: Historical release notes must be included`)
  assert.ok(!entries.some((entry) => entry.version === '3.0.16'), 'Exclude unconfirmed versions')
  return entries
})
assert.deepEqual(
  Array.from(documents[0], (entry) => [entry.version, entry.notes.length]),
  Array.from(documents[1], (entry) => [entry.version, entry.notes.length]),
  'Chinese and English documents must cover the same versions and changes'
)
assert.match(documents[0][0].notes.join(' '), /\p{Script=Han}/u)
assert.doesNotMatch(documents[1][0].notes.join(' '), /\p{Script=Han}/u)
console.log('Changelog tests passed')
