/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Electron pixel regression test. */
// Run with: electron scripts/check-range-colors.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { parse, compileScript } = require('vue/compiler-sfc')

app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'ep-range-colors-')))
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 400,
    height: 200,
    webPreferences: { sandbox: true, backgroundThrottling: false }
  })
  try {
    await window.loadURL(
      'data:text/html,<html><head></head><body><div id="host"></div></body></html>'
    )
    await window.webContents.executeJavaScript(
      readFileSync('node_modules/vue/dist/vue.global.prod.js', 'utf8')
    )
    const { descriptor } = parse(
      readFileSync('src/renderer/src/components/ui/BaseRange.vue', 'utf8')
    )
    const component = ts.transpileModule(
      compileScript(descriptor, { id: 'range-colors', inlineTemplate: true }).content,
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
    ).outputText
    const css = readFileSync('src/renderer/src/styles/components.css', 'utf8')
    await window.webContents.executeJavaScript(`
      const rangeModule = {};
      (function(exports, require) { ${component} })(rangeModule, () => Vue);
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(css)} +
        'body{margin:0;background:white}#host{padding:20px}.ep-range{display:block;box-sizing:border-box;margin:0;padding:0;border:0;width:200px;height:40px;--ep-range-track-height:8px;--ep-progress-fill:rgb(255 0 0);--ep-progress-track:rgb(0 0 255);--ep-range-thumb-bg:transparent}';
      document.head.append(style);
      const values = Vue.reactive({value:25});
      Vue.createApp({render:() => Vue.h(rangeModule.default, values)}).mount('#host');
      void 0;
    `)

    // Sample the actual track pixels, including transparent/alpha theme colors.
    // Computed declarations alone cannot detect fill leaking through another layer.
    const cases = [
      { value: 25, track: 'rgb(0 0 255)', show: 1, left: [255, 0, 0], right: [0, 0, 255] },
      { value: 25, track: 'transparent', show: 1, left: [255, 0, 0], right: [255, 255, 255] },
      {
        value: 50,
        track: 'rgb(0 0 255 / 50%)',
        show: 1,
        left: [255, 0, 0],
        right: [127, 127, 255]
      },
      { value: 50, track: 'rgb(0 0 255)', show: 0, left: [255, 0, 0], right: [255, 255, 255] },
      { value: 0, track: 'rgb(0 0 255)', show: 1, left: [0, 0, 255], right: [0, 0, 255] },
      { value: 0, track: 'transparent', show: 0, left: [255, 255, 255], right: [255, 255, 255] },
      {
        value: 25,
        track: 'rgb(0 0 255)',
        show: 1,
        fill: 'linear-gradient(rgb(0 255 0), rgb(0 255 0))',
        thumbWidth: '60px',
        left: [0, 255, 0],
        right: [0, 0, 255]
      },
      { value: 100, track: 'rgb(0 0 255)', show: 1, left: [255, 0, 0], right: [255, 0, 0] }
    ]
    for (const test of cases) {
      const rect = await window.webContents.executeJavaScript(`(async () => {
        values.value = ${test.value}; await Vue.nextTick();
        const range = document.querySelector('.ep-range');
        range.style.setProperty('--ep-range-unplayed-color', ${JSON.stringify(test.track)});
        range.style.setProperty('--ep-range-show-unplayed', '${test.show}');
        range.style.setProperty('--ep-range-thumb-width', '${test.thumbWidth || '16px'}');
        range.style.setProperty('--ep-range-fill-background', ${JSON.stringify(test.fill || 'linear-gradient(red, red)')});
        const bounds = range.getBoundingClientRect();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
      })()`)
      const bitmap = (await window.webContents.capturePage(rect)).toBitmap()
      const pixel = (x) => {
        const offset = (20 * rect.width + x) * 4
        return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]]
      }
      for (const [label, x] of [
        ['left', 25],
        ['right', 175]
      ]) {
        assert.ok(
          pixel(x).every((channel, i) => Math.abs(channel - test[label][i]) <= 1),
          `${JSON.stringify(test)} ${label}: got ${pixel(x)}, expected ${test[label]}`
        )
      }
    }
    console.log(
      'Range pixels passed: opaque/transparent/alpha tracks, top-line mode, zero/full progress'
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
