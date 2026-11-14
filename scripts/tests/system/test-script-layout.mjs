/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? files(file) : [file]
  })
}
const scriptFiles = files('scripts')
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
for (const file of [
  'package.json',
  'electron-builder.yml',
  'resources/lib/CMakeLists.txt',
  ...files('.github/workflows')
]) {
  const text = fs.readFileSync(file, 'utf8')
  for (const [reference] of text.matchAll(/scripts\/[\w./-]+\.(?:[cm]?[jt]s|py|ps1|nsh)/g)) {
    assert.ok(fs.existsSync(reference), `${file}: missing ${reference}`)
  }
  for (const [, command] of text.matchAll(/npm run ([\w:-]+)/g)) {
    assert.ok(packageJson.scripts[command], `${file}: missing npm command ${command}`)
  }
}
let count = 0
for (const file of scriptFiles.filter((file) => /\.[cm]?[jt]s$/.test(file))) {
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  function visit(node) {
    if (ts.isStringLiteral(node) && /^\.\.?\//.test(node.text)) {
      const parent = node.parent
      const moduleReference =
        ts.isImportDeclaration(parent) ||
        ts.isExportDeclaration(parent) ||
        (ts.isCallExpression(parent) && parent.expression.getText(source) === 'require')
      const sourceUrl =
        ts.isNewExpression(parent) &&
        parent.expression.getText(source) === 'URL' &&
        parent.arguments?.[1]?.getText(source) === 'import.meta.url'
      if (moduleReference || sourceUrl) {
        const target = path.resolve(path.dirname(file), node.text)
        assert.ok(
          [target, target + '.ts', target + '.js', target + '.mjs', target + '.cjs'].some(
            fs.existsSync
          ),
          `${file}: missing ${node.text}`
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  count++
}
assert.ok(scriptFiles.length > 0)
console.log(`Script layout: config/CI entry points and ${count} module/source references checked`)
