/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Native Electron material smoke check. */
// Run: electron scripts/check-window-material.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-window-material-')))
function load(file, shared) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    { exports, require: () => shared }
  )
  return exports
}
app.whenReady().then(() => {
  try {
    const shared = load('src/shared/windowMaterial.ts')
    const { createWindowMaterialManager } = load(
      'src/main/service/windowMaterialService.ts',
      shared
    )
    const window = new BrowserWindow({ show: false })
    const settings = new Map()
    const manager = createWindowMaterialManager({
      platform: process.platform,
      release: os.release(),
      window: () => window,
      read: (key) => settings.get(key),
      write: (key, value) => settings.set(key, value)
    })
    for (const material of manager.state().available) {
      manager.select(material)
      assert.equal(manager.state().material, material)
    }
    manager.select('none')
    window.destroy()
    console.log('Native window material calls passed: ' + manager.state().available.join(', '))
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
