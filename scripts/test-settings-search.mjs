/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const exports = {}
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/renderer/src/utils/settingsSearch.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  { exports }
)
const { normalizeSettingsSearch, createSettingsSearchTranslator, searchSettings } = exports
const translate = createSettingsSearchTranslator([
  {
    system: '系统',
    updates: '应用更新',
    startup: '启动时检查',
    description: '仅启动时检查版本。',
    status: '发现新版本 {version}。'
  },
  {
    system: 'System',
    updates: 'Updates',
    startup: 'Check at startup',
    description: 'Check only on launch.',
    status: 'Version {version} is available.'
  },
  { startup: 'Vérifier au démarrage' }
])
assert.equal(normalizeSettingsSearch('  ＳＹＳＴＥＭ  Vérifier\n'), 'system verifier')
assert.ok(translate(['启动时检查']).includes('verifier au demarrage'))
assert.ok(translate(['发现新版本 3.7.0。']).includes('version is available.'))
assert.ok(
  !translate(['发现新版本']).includes('is available'),
  'partial text cannot accidentally match a parameterized message'
)
const entry = (id, title, path, description, body) => ({
  id,
  title,
  path,
  description,
  fields: {
    title: translate([title]),
    path: translate(path),
    description: translate([description]),
    body: translate([body])
  }
})
const entries = [
  entry('body', '文档', [], '', '启动时检查'),
  entry('description', '网络', [], '启动时检查', ''),
  entry('hierarchy', '代理', ['系统', '应用更新', '启动时检查'], '', ''),
  entry('title', '启动时检查', ['系统', '应用更新'], '仅启动时检查版本。', 'release history')
]
const ids = (query) => Array.from(searchSettings(entries, query), (result) => result.id)
assert.deepEqual(
  ids('startup'),
  ['title', 'hierarchy', 'description', 'body'],
  'title matches rank above parent titles, descriptions and body'
)
assert.deepEqual(
  ids('SYSTEM > updates / startup'),
  ['title', 'hierarchy'],
  'all hierarchy query terms must match'
)
assert.deepEqual(
  ids('系统 updates launch'),
  ['title'],
  'mixed-language terms can match different heading and description levels'
)
assert.deepEqual(ids('release history'), ['title'], 'body content is searchable')
assert.deepEqual(ids('系统 nonmatching'), [], 'unmatched tokens do not leak unrelated results')
assert.deepEqual(ids('  '), [])
assert.deepEqual(ids('[]()'), [], 'search input is literal, not executable regex')
assert.ok(
  !translate(['启动']).includes('startup'),
  'translation aliases require complete messages rather than generic substrings'
)
console.log(
  'Settings search: hierarchy, multilingual aliases, dynamic descriptions, ranking, normalization, body and literal query checks passed'
)
