/* eslint-disable @typescript-eslint/no-require-imports -- Electron dialog integration check. */
// Run with the Vite development server: electron scripts/check-mica-dialog.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const esbuild = require('esbuild')
const { parse, compileScript } = require('vue/compiler-sfc')

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-mica-dialog-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const component = compileScript(
      parse(fs.readFileSync('src/renderer/src/components/ui/BaseDialog.vue', 'utf8')).descriptor,
      { id: 'mica-dialog-check', inlineTemplate: true }
    ).content
    const module = ts.transpileModule(component, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    const bundle = await esbuild.build({
      stdin: { contents: module + '\nexports.Vue=require("vue");', resolveDir: process.cwd() },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'DialogCheck',
      alias: { vue: require.resolve('vue/dist/vue.esm-bundler.js') },
      write: false
    })
    const response = await fetch('http://127.0.0.1:5173/src/styles/index.css?direct')
    assert.ok(response.ok, 'Vite must serve the shared application styles')
    const css = await response.text()
    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, backgroundThrottling: false }
    })
    await window.loadURL('data:text/html,<html><head></head><body></body></html>')
    // Hidden native windows do not reliably receive compositor frames.
    await window.webContents.executeJavaScript(`
      window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);
      window.cancelAnimationFrame = clearTimeout;
      void 0;
    `)
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const result = await window.webContents.executeJavaScript(`(async () => {
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(css)};
      document.head.append(style);
      document.body.innerHTML = '<div id="app"><p>Background</p><div id="mount"></div></div>';
      const {createApp, h, reactive, nextTick} = DialogCheck.Vue;
      const state = reactive({show:true, blur:true});
      createApp({render:() => h(DialogCheck.default, {
        modelValue:state.show, blur:state.blur, title:'Dialog'
      }, () => h('p', 'Modal content'))}).mount('#mount');
      const settle = async () => {
        await nextTick(); await new Promise(resolve => setTimeout(resolve, 500));
      };
      const read = () => {
        const app = document.querySelector('#app');
        const panel = document.querySelector('.ep-dialog-panel');
        const overlay = document.querySelector('.ep-overlay');
        const dialog = document.querySelector('.ep-dialog');
        return {
          app:getComputedStyle(app).filter,
          backdrop:overlay ? getComputedStyle(overlay).backdropFilter : null,
          panel:panel ? getComputedStyle(panel).filter : null,
          portalOutsideApp:panel ? !app.contains(panel) : true,
          overlayColor:overlay ? getComputedStyle(overlay).backgroundColor : null,
          dialogState:dialog?.getAttribute('data-headlessui-state'),
          dialogDisplay:dialog ? getComputedStyle(dialog).display : null
        };
      };
      await settle(); const normal = read();
      document.documentElement.classList.add('mica-enabled'); await settle(); const mica = read();
      state.blur=false; await settle(); const noBlur = read();
      state.blur=true; document.documentElement.classList.remove('mica-enabled');
      await settle(); const restored = read();
      document.documentElement.classList.add('mica-enabled'); state.show=false;
      await settle(); const closed = read();
      return {normal,mica,noBlur,restored,closed};
    })()`)
    assert.equal(result.normal.app, 'none')
    assert.match(result.normal.backdrop, /blur/)
    assert.match(result.mica.app, /blur/)
    assert.equal(result.mica.backdrop, 'none')
    assert.equal(result.mica.panel, 'none')
    assert.equal(result.mica.portalOutsideApp, true)
    assert.equal(result.mica.overlayColor, result.normal.overlayColor)
    assert.equal(result.noBlur.app, 'none')
    assert.equal(result.noBlur.backdrop, 'none')
    assert.equal(result.restored.app, 'none')
    assert.match(result.restored.backdrop, /blur/)
    assert.equal(result.closed.app, 'none')
    console.log(
      'Mica dialog compatibility: blur routing, portal isolation, mode changes and cleanup passed'
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
