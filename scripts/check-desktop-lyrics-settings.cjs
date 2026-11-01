/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.resolve('build/desktop-settings-')))
app.disableHardwareAcceleration()

async function checkSettings() {
  const { Vue, createI18n, Settings, zh } = window.Fixture
  const { createApp, reactive, nextTick } = Vue
  const wait = async (ms = 100) => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  const check = (ok, message) => {
    if (!ok) throw Error(message)
  }
  document.hasFocus = () => true
  window.desktopUi = reactive({
    customFontFamily: 'Arial',
    reduceMotion: false,
    resolveFontStack: (family) => family || 'Arial',
    desktopLyricsStyles: {
      fontFamily: '',
      fontSize: 34,
      activeColor: '#ffffff',
      inactiveColor: '#aaaaaa',
      fontBold: false,
      glow: false,
      sweep: false,
      showTranslation: true,
      autoHideBackground: false
    }
  })
  const instance = createApp(Settings, {
    fontOptions: [{ label: 'Monospace', value: 'monospace' }]
  }).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
  instance.mount('#app')
  await wait()
  const preview = () => document.querySelector('.desktop-lyrics-preview')
  const highlight = () => document.querySelector('.desktop-lyrics-preview-highlight')
  const styles = window.desktopUi.desktopLyricsStyles
  const toggle = (label) =>
    document.querySelector('.desktop-lyrics-toggles [role=switch][aria-label="' + label + '"]')
  check(
    preview().getBoundingClientRect().top <
      document.querySelector('.setting-row').getBoundingClientRect().top,
    'Preview comes before settings controls'
  )
  document
    .querySelector('.desktop-lyrics-size-control [role=slider]')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await wait()
  check(
    styles.fontSize === 35 && getComputedStyle(preview()).fontSize === '35px',
    'Font-size control updates preview at its real size'
  )
  document.querySelector('.desktop-lyrics-font-select button').click()
  await wait()
  ;[...document.querySelectorAll('[role=option]')]
    .find((option) => option.textContent.includes('Monospace'))
    .click()
  await wait()
  check(
    getComputedStyle(preview()).fontFamily === 'monospace',
    'Font selector updates preview family'
  )
  for (const [index, field] of ['activeColor', 'inactiveColor'].entries()) {
    const trigger = document
      .querySelectorAll('.desktop-lyrics-colors .setting-row')
      [index].querySelector('button')
    trigger.click()
    await wait()
    const preset = [...document.querySelectorAll('button[aria-label]')].filter((button) =>
      button.getAttribute('aria-label')?.startsWith('#')
    )[index]
    const color = preset.getAttribute('aria-label')
    preset.click()
    await wait()
    check(styles[field].toLowerCase() === color.toLowerCase(), 'Color picker updates ' + field)
    check(
      getComputedStyle(preview())
        .getPropertyValue(index ? '--desktop-inactive' : '--desktop-active')
        .trim()
        .toLowerCase() === color.toLowerCase(),
      'Preview immediately uses ' + field
    )
    trigger.click()
    await wait()
  }
  toggle('粗体').click()
  await wait()
  check(getComputedStyle(highlight()).fontWeight === '700', 'Bold switch updates preview text')
  toggle('发光效果').click()
  await wait()
  check(getComputedStyle(highlight()).textShadow !== 'none', 'Glow switch updates preview shadow')
  toggle('扫动模式').click()
  await wait(500)
  const clip = getComputedStyle(highlight()).clipPath
  await wait(450)
  check(
    getComputedStyle(highlight()).clipPath !== clip,
    'Sweep preview animates instead of staying at a fixed percentage'
  )
  toggle('显示翻译').click()
  await wait()
  check(
    document.querySelector('.desktop-lyrics-preview-secondary').textContent.trim() ===
      zh.settings.desktopLyricsPreviewNext,
    'Translation switch changes the preview second row'
  )
  toggle('自动隐藏背景').click()
  await wait()
  check(
    !preview().classList.contains('desktop-lyrics-preview--background'),
    'Auto-hide switch hides preview backdrop'
  )
  const stage = document.querySelector('.desktop-lyrics-preview-stage')
  stage.dispatchEvent(new MouseEvent('mouseenter'))
  await wait()
  check(
    preview().classList.contains('desktop-lyrics-preview--background'),
    'Hover reveals preview backdrop'
  )
  stage.dispatchEvent(new MouseEvent('mouseleave'))
  await wait()
  check(
    !preview().classList.contains('desktop-lyrics-preview--background'),
    'Leaving hides preview backdrop again'
  )
  window.checkDesktopLayout = () => {
    const colors = [...document.querySelectorAll('.desktop-lyrics-colors .setting-row')].map((el) =>
      el.getBoundingClientRect()
    )
    const toggles = [...document.querySelectorAll('.desktop-lyrics-toggles .setting-row')].map(
      (el) => el.getBoundingClientRect()
    )
    check(Math.abs(colors[0].top - colors[1].top) < 1, 'Both colors stay on one row')
    check(
      new Set(toggles.map((rect) => Math.round(rect.top))).size === 3,
      'Five effects occupy three rows'
    )
    const card = document.querySelector('.settings-card')
    check(card.scrollWidth <= card.clientWidth + 1, 'Controls and preview stay inside the card')
    check(
      document.querySelector('.desktop-lyrics-size-control [role=slider]').getBoundingClientRect()
        .width > 100,
      'Font-size slider retains a usable track'
    )
    for (const row of document.querySelectorAll('.setting-row'))
      check(row.scrollWidth <= row.clientWidth + 1, 'Setting contents fit within their row')
  }
  window.checkDesktopLayout()
  return 'Desktop lyrics settings passed: preview first, real font size, font family, both colors, bold, glow, animated sweep, translation, hover backdrop and layout.'
}

app.whenReady().then(async () => {
  try {
    const styles = []
    let scope = 0
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents:
          "export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {default as Settings} from './src/renderer/src/components/settings/DesktopLyricsSettings.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';"
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'Fixture',
      alias: {
        vue: require.resolve('vue/dist/vue.esm-bundler.js'),
        '@': path.resolve('src/renderer/src')
      },
      define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      plugins: [
        {
          name: 'fixture',
          setup(build) {
            build.onResolve({ filter: /stores[\\/]ui[\\/]uiStore$/ }, () => ({
              path: 'ui',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: 'export const useUIStore=()=>window.desktopUi'
            }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              const id = 'desktop-' + ++scope
              for (const style of descriptor.styles)
                styles.push(
                  compileStyle({
                    source: style.content,
                    filename,
                    id: 'data-v-' + id,
                    scoped: style.scoped
                  }).code
                )
              return {
                contents:
                  compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: '__sfc__' })
                    .content +
                  '\n__sfc__.__scopeId="data-v-' +
                  id +
                  '";export default __sfc__;',
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    const win = new BrowserWindow({
      show: false,
      width: 1024,
      height: 980,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    const file = path.join(app.getPath('userData'), 'fixture.html')
    fs.writeFileSync(
      file,
      '<html><body><main id="app" class="settings-page" style="padding:24px;max-width:960px;margin:auto"></main></body></html>'
    )
    await win.loadFile(file)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const css = fs.readdirSync('out/renderer/assets').find((name) => /^main-.*\.css$/.test(name))
    await win.webContents.insertCSS(
      fs.readFileSync(path.join('out/renderer/assets', css), 'utf8') +
        '\n' +
        fs.readFileSync('src/renderer/src/styles/settings.css', 'utf8') +
        '\n' +
        styles.join('\n')
    )
    const result = await win.webContents.executeJavaScript(
      '(' + checkSettings.toString() + ')().catch(error=>({error:error.stack}))'
    )
    if (result.error) throw Error(result.error)
    console.log(result)
    fs.writeFileSync(
      path.resolve('build/desktop-lyrics-settings.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    win.setSize(520, 980)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await win.webContents.executeJavaScript('window.checkDesktopLayout()')
    fs.writeFileSync(
      path.resolve('build/desktop-lyrics-settings-narrow.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    console.log('Desktop lyrics layout passed at 1024px and 520px widths.')
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
