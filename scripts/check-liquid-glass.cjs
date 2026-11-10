/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-glass-'))
app.setPath('userData', path.join(temporary, 'profile'))
if (process.env.EP_GLASS_SOFTWARE === '1') app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', process.env.EP_GLASS_DPR || '1')

app.whenReady().then(async () => {
  try {
    const output = path.resolve('build/themes/liquid-glass')
    fs.mkdirSync(output, { recursive: true })
    const manifest = JSON.parse(fs.readFileSync('docs/themes/liquid-glass/manifest.json', 'utf8'))
    const { packTheme } = await import('./pack-theme.mjs')
    const packed = await packTheme('docs/themes/liquid-glass', output)
    await esbuild.build({
      stdin: {
        contents:
          "export * from './src/main/plugins/packages';export * from './src/main/plugins/manager';export * from './src/main/sources/registry'",
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      outfile: path.join(output, 'check-host.cjs')
    })
    const { OfficialPluginPackages, PluginManager, SourceRegistry } = require(
      path.join(output, 'check-host.cjs')
    )
    const manager = new PluginManager(new SourceRegistry(), {
      readSetting() {
        return undefined
      },
      writeSetting() {
        /* Preferences remain isolated to this fixture. */
      },
      log() {
        /* Assertions report failures. */
      },
      fetch() {
        throw Error('Unexpected network')
      }
    })
    const packages = new OfficialPluginPackages(
      path.join(temporary, 'installed'),
      manager,
      {},
      { schemaVersion: 1, plugins: [] }
    )
    packages.initialize()
    await packages.installFile(path.join(output, packed.filename), () => true)
    const plugin = packages.listThemes().find((item) => item.pluginId === manifest.id)
    assert(plugin, 'Real .epp installs as an active third-party theme')
    assert.deepEqual(
      plugin.data.glass,
      JSON.parse(fs.readFileSync('docs/themes/liquid-glass/theme.json', 'utf8')).glass
    )
    const bundle = await esbuild.build({
      stdin: {
        contents:
          "export {applyCustomTheme,parseCustomTheme} from './src/renderer/src/services/customTheme'",
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Glass'
    })
    const win = new BrowserWindow({
      show: false,
      x: 0,
      y: 0,
      width: 1120,
      height: 760,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, offscreen: true }
    })
    const csp = fs
      .readFileSync('src/renderer/index.html', 'utf8')
      .match(/content="(default-src[^"]+)"/)[1]
    const html = `<!doctype html><html class="dark"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
      *{box-sizing:border-box}body{margin:0;font:14px 'Segoe UI',sans-serif;color:var(--color-text);height:100vh;background:#10243a}
      .scene{position:fixed;inset:0;background:repeating-linear-gradient(110deg,transparent 0 80px,#8adddf44 81px 84px,transparent 85px 150px)}
      .ep-header{position:relative;height:64px;background:var(--app-header-bg);padding:20px 28px}
      .ep-sidebar{position:absolute;top:84px;bottom:135px;left:24px;width:210px;background:var(--ep-sidebar-bg);padding:24px;border-radius:22px}
      .ep-dialog-panel{position:absolute;top:110px;left:270px;width:430px;padding:32px;background:var(--ep-dialog-bg);border-radius:var(--ep-dialog-radius);box-shadow:var(--ep-surface-shadow)}
      .ep-menu{position:absolute;right:36px;top:300px;width:290px;padding:24px;border:1px solid;border-radius:18px}
      .ep-footer{position:absolute;bottom:24px;left:24px;right:24px;background:var(--app-footer-bg);padding:24px;border:1px solid var(--color-border)}
      h1{font-size:34px;margin:0 0 12px}h2{font-size:20px}p{color:var(--color-text-l);line-height:1.8}small{color:var(--color-text-l2)}
      button{font:inherit;cursor:pointer;padding:10px 18px;border-radius:var(--ep-button-radius);border:1px solid var(--color-border)}
      .ep-button--primary{background:#a6e8f5;color:#0c1727}.ep-button--secondary{background:var(--color-bg-l2);color:var(--color-text)}
      .ep-input{padding:12px;border:1px solid var(--color-border);color:var(--color-text);width:100%;margin:10px 0 24px}
      .probe{position:absolute;left:50px;top:70px;width:430px;height:320px;background:transparent;border-radius:22px}
      .stripes{background:repeating-linear-gradient(90deg,#eeeeee 0 8px,#242424 8px 16px)}
    </style></head><body><div class="scene"></div><header class="ep-header">EASY PLAYER <span style="float:right">LIQUID GLASS</span></header><aside class="ep-sidebar"><small>音乐资料库</small><h2>为你推荐</h2><p>我的音乐</p><p>收藏的专辑</p><p>最近播放</p></aside><main class="ep-dialog-panel"><small>APPEARANCE / 外观</small><h1>流光玻璃</h1><p>让音乐浮于光影之间。<br>通透材质，柔和折射。</p><input class="ep-input" placeholder="搜索你的音乐…"><button class="ep-button--primary">播放音乐</button> <button class="ep-button--secondary">加入歌单</button></main><div class="ep-menu"><small>NOW PLAYING</small><h2>Midnight reflections</h2><p>静夜里的每一个音符<br>都值得被听见。</p></div><footer class="ep-footer">♫ &nbsp; Midnight reflections <span style="float:right">◀ &nbsp; ▶ &nbsp; ▶▶ &nbsp; ━━━━━━━━━ &nbsp; 02:48</span></footer></body></html>`
    const filename = path.join(output, 'preview.html')
    fs.writeFileSync(filename, html)
    await win.loadFile(filename)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const apply = async (data) =>
      win.webContents.executeJavaScript(`Glass.applyCustomTheme(${JSON.stringify(data)})`)
    await win.webContents.executeJavaScript(
      `document.body.style.background=${JSON.stringify(plugin.data.background)}`
    )
    const theme = {
      version: 1,
      name: 'Liquid Glass',
      tokens: {
        ...plugin.data.tokens,
        '--app-header-bg': plugin.data.headerBackground,
        '--app-footer-bg': plugin.data.footerBackground
      },
      rules: plugin.data.rules,
      plugin
    }
    await apply(theme)
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (process.env.EP_GLASS_SOFTWARE === '1') {
      assert.equal(
        await win.webContents.executeJavaScript(`document.querySelectorAll('filter').length`),
        0,
        'Software compositor must use CSS fallback'
      )
      assert.match(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.ep-footer')).backdropFilter`
        ),
        /blur/
      )
      await apply(null)
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('[id^="ep-theme-glass"]').length`
        ),
        0
      )
      win.destroy()
      console.log('Liquid Glass: software compositor CSS fallback and cleanup passed')
      app.exit(0)
      return
    }
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('feDisplacementMap').length`
      ),
      20
    )
    await apply(theme)
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('feDisplacementMap').length`
      ),
      20,
      'Repeated applications reuse the filter'
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    fs.writeFileSync(
      path.join(output, 'preview.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    const rimLayer = await win.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('.ep-header')).backgroundImage`
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('.ep-input').dispatchEvent(new Event('input',{bubbles:true}))`
    )
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.match(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-header')).backdropFilter`
      ),
      /-fast/,
      'Input must select the cached light refraction path'
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-header')).backgroundImage`
      ),
      rimLayer,
      'Interaction keeps the same coloured edge light'
    )
    await new Promise((resolve) => setTimeout(resolve, 240))
    assert.doesNotMatch(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-header')).backdropFilter`
      ),
      /-fast/,
      'Idle restores full RGB background sampling'
    )
    // The shipped clear preset keeps stripe contrast in the flat header centre,
    // and moving the pointer anywhere in the page cannot move its illumination.
    await win.webContents.executeJavaScript(
      `document.querySelector('.scene').style.display='none';document.body.style.background='repeating-linear-gradient(90deg,#eeeeee 0 8px,#242424 8px 16px)'`
    )
    await new Promise((resolve) => setTimeout(resolve, 120))
    const clearHeader = (
      await win.webContents.capturePage({ x: 400, y: 20, width: 128, height: 24 })
    ).toBitmap()
    const headerRange = []
    for (let i = 0; i < clearHeader.length; i += 4) headerRange.push(clearHeader[i])
    assert(
      Math.max(...headerRange) - Math.min(...headerRange) > 160,
      'Clear header must retain background contrast instead of frosting it'
    )
    const fixedLights = await win.webContents.executeJavaScript(
      `JSON.stringify([...document.querySelectorAll('[result="normal-dot-half"]')].map(el=>el.getAttribute('values')))`
    )
    await win.webContents.executeJavaScript(
      `document.body.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:700,clientY:400}));document.body.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:10,clientY:700}))`
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(
      await win.webContents.executeJavaScript(
        `JSON.stringify([...document.querySelectorAll('[result="normal-dot-half"]')].map(el=>el.getAttribute('values')))`
      ),
      fixedLights,
      'External pointer movement must not change the shipped material light'
    )
    const stillHeader = (
      await win.webContents.capturePage({ x: 400, y: 20, width: 128, height: 24 })
    ).toBitmap()
    assert(
      clearHeader.equals(stillHeader),
      'External pointer movement must leave header pixels unchanged'
    )
    // A striped backdrop proves displacement changes rendered pixels, beyond CSS.supports.
    await win.webContents.executeJavaScript(
      `document.body.innerHTML='<div class="probe ep-glass-probe"></div>'; document.body.style.background=''; document.body.className='stripes'`
    )
    const probe = (options) => ({
      ...theme,
      rules: { '.ep-glass-probe': { 'box-shadow': 'none' } },
      plugin: {
        ...plugin,
        data: {
          ...plugin.data,
          glass: {
            selectors: ['.ep-glass-probe'],
            blur: 0,
            refraction: 0,
            saturation: 1,
            fresnel: 0,
            highlight: 0,
            dispersion: 0,
            shadow: 0,
            interactive: false,
            ...(typeof options === 'number' ? { refraction: options } : options)
          }
        }
      }
    })
    await apply(probe(0))
    await new Promise((resolve) => setTimeout(resolve, 100))
    const before = (
      await win.webContents.capturePage({ x: 50, y: 70, width: 430, height: 320 })
    ).toBitmap()
    await apply(probe(40))
    await new Promise((resolve) => setTimeout(resolve, 200))
    const after = (
      await win.webContents.capturePage({ x: 50, y: 70, width: 430, height: 320 })
    ).toBitmap()
    let changed = 0
    for (let i = 0; i < before.length; i += 4) if (Math.abs(before[i] - after[i]) > 10) changed++
    assert(changed > 500, `SVG must visibly refract the backdrop: ${changed} changed pixels`)
    fs.writeFileSync(
      path.join(output, 'optics-probe.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    const pause = async () => {
      await win.webContents.executeJavaScript(
        `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`
      )
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    const capture = async (options) => {
      await apply(probe(options))
      await pause()
      return (
        await win.webContents.capturePage({ x: 50, y: 70, width: 430, height: 320 })
      ).toBitmap()
    }
    const differences = (a, b) => {
      let count = 0
      for (let i = 0; i < a.length; i += 4)
        if (Math.max(...[0, 1, 2].map((c) => Math.abs(a[i + c] - b[i + c]))) > 8) count++
      return count
    }
    // Padding must not move optical geometry into the content box.
    await win.webContents.executeJavaScript(`document.querySelector('.probe').style.padding='30px'`)
    await pause()
    const padded = (
      await win.webContents.capturePage({ x: 50, y: 70, width: 430, height: 320 })
    ).toBitmap()
    assert(differences(after, padded) < 50, 'Optical bounds must ignore content padding')
    const dispersed = await capture({ refraction: 40, dispersion: 1 })
    let colourPixels = 0
    for (let i = 0; i < dispersed.length; i += 4)
      if (
        Math.max(dispersed[i], dispersed[i + 1], dispersed[i + 2]) -
          Math.min(dispersed[i], dispersed[i + 1], dispersed[i + 2]) >
        12
      )
        colourPixels++
    assert(colourPixels > 200, `RGB sampling must split achromatic edges: ${colourPixels}`)
    const dispersionWidth = Math.round(Math.sqrt(((dispersed.length / 4) * 430) / 320))
    const dispersionDpr = dispersionWidth / 430
    let refractedColour = 0
    for (let y = 80; y < 240; y++)
      for (let x = 4; x < 11; x++) {
        const i =
          (Math.floor(y * dispersionDpr) * dispersionWidth + Math.floor(x * dispersionDpr)) * 4
        if (
          Math.max(dispersed[i], dispersed[i + 1], dispersed[i + 2]) -
            Math.min(dispersed[i], dispersed[i + 1], dispersed[i + 2]) >
          20
        )
          refractedColour++
      }
    assert(
      refractedColour > 50,
      'Real RGB refraction must remain visible beyond the narrow baked rim'
    )
    fs.writeFileSync(
      path.join(output, 'dispersion.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    const liveMap = await win.webContents.executeJavaScript(
      `document.querySelector('filter feImage').getAttribute('href')`
    )
    await win.webContents.executeJavaScript(`document.body.style.backgroundPosition='5px 0'`)
    await pause()
    const movedBackdrop = (
      await win.webContents.capturePage({ x: 50, y: 70, width: 430, height: 320 })
    ).toBitmap()
    assert(
      differences(dispersed, movedBackdrop) > 10000,
      'Live background pixels must update without recapturing the DOM'
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('filter feImage').getAttribute('href')`
      ),
      liveMap
    )
    const unblurred = await capture({})
    const blurred = await capture({ blur: 8 })
    assert(
      differences(unblurred, blurred) > 10000,
      'Interior Gaussian blur must affect real backdrop pixels'
    )
    await win.webContents.executeJavaScript(`document.body.style.background='#181818'`)
    const neutral = await capture({})
    const reflected = await capture({ fresnel: 1 })
    const pixelWidth = Math.round(Math.sqrt(((reflected.length / 4) * 430) / 320))
    const dpr = pixelWidth / 430
    const luminance = (pixels, x, y) => {
      const i = (Math.floor(y * dpr) * pixelWidth + Math.floor(x * dpr)) * 4
      return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
    }
    const edgeGain = luminance(reflected, 0, 160) - luminance(neutral, 0, 160)
    const centreGain = luminance(reflected, 215, 160) - luminance(neutral, 215, 160)
    assert(
      edgeGain > centreGain + 20,
      `Fresnel must increase at grazing angles: ${edgeGain} vs ${centreGain}`
    )
    const highlighted = await capture({ highlight: 2, lightAngle: 270 })
    fs.writeFileSync(
      path.join(output, 'edge-highlight.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    assert(
      differences(neutral, highlighted) > 100,
      'Directional specular must visibly illuminate the edge: ' + differences(neutral, highlighted)
    )
    const opposite = await capture({ highlight: 2, lightAngle: 90 })
    assert(differences(highlighted, opposite) > 100, 'Specular must follow the light direction')
    await win.webContents.executeJavaScript(`document.body.style.background='#899aaa'`)
    const shadowless = probe({})
    shadowless.rules = {}
    await apply(shadowless)
    await pause()
    const outsideBefore = (
      await win.webContents.capturePage({ x: 0, y: 20, width: 530, height: 420 })
    ).toBitmap()
    const shadowed = probe({ shadow: 1 })
    shadowed.rules = {}
    await apply(shadowed)
    await pause()
    const outsideAfter = (
      await win.webContents.capturePage({ x: 0, y: 20, width: 530, height: 420 })
    ).toBitmap()
    assert(
      differences(outsideBefore, outsideAfter) > 500,
      'Soft cast shadows must extend beyond the panel'
    )
    await capture({ highlight: 2, interactive: true })
    const lightValues = () =>
      win.webContents.executeJavaScript(
        `document.querySelector('[result="normal-dot-half"]').getAttribute('values')`
      )
    const staticLight = await lightValues()
    const mapBefore = await win.webContents.executeJavaScript(
      `document.querySelector('filter feImage').getAttribute('href')`
    )
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new PointerEvent('pointermove',{clientX:900,clientY:100}))`
    )
    await pause()
    assert.equal(
      await lightValues(),
      staticLight,
      'Opt-in lighting must ignore pointers outside its surface'
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('.probe').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:400,clientY:110}))`
    )
    await pause()
    assert.notEqual(
      await lightValues(),
      staticLight,
      'Opt-in response must stay local to the hovered surface'
    )
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new PointerEvent('pointermove',{clientX:900,clientY:100}))`
    )
    await pause()
    assert.equal(
      await lightValues(),
      staticLight,
      'Moving back outside restores the fixed illumination'
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('filter feImage').getAttribute('href')`
      ),
      mapBefore,
      'Pointer lighting must reuse geometry maps'
    )
    await win.webContents.executeJavaScript(
      `document.documentElement.classList.add('reduce-motion')`
    )
    await pause()
    const reducedLight = await lightValues()
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new PointerEvent('pointermove',{clientX:0,clientY:600}))`
    )
    await pause()
    assert.equal(await lightValues(), reducedLight, 'Reduced motion freezes pointer lighting')
    await win.webContents.executeJavaScript(
      `document.documentElement.classList.remove('reduce-motion');document.dispatchEvent(new Event('pointerleave'))`
    )
    // A late portal gets a separate size-correct filter and releases it when removed.
    await win.webContents.executeJavaScript(
      `const late=document.createElement('div');late.className='ep-glass-probe';late.id='late';late.style.cssText='position:absolute;left:550px;top:100px;width:200px;height:90px;border-radius:45px';document.body.append(late)`
    )
    await pause()
    assert.equal(
      await win.webContents.executeJavaScript(`document.querySelectorAll('filter').length`),
      2
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('#late').remove();document.querySelector('.probe').style.width='200px';document.querySelector('.probe').style.height='120px'`
    )
    await pause()
    assert.equal(
      await win.webContents.executeJavaScript(`document.querySelectorAll('filter').length`),
      1
    )
    const mapHeader = await win.webContents.executeJavaScript(
      `document.querySelector('filter feImage').getAttribute('href').split(',')[1]`
    )
    assert.equal(
      Buffer.from(mapHeader, 'base64').readUInt32BE(16),
      200 * dpr,
      'Resize rebuilds a correctly sized map'
    )
    await win.webContents.executeJavaScript(
      `const wrapper=document.createElement('div');wrapper.id='hidden-wrapper';wrapper.style.display='none';wrapper.innerHTML='<div class="ep-glass-probe" style="position:absolute;left:600px;top:200px;width:160px;height:80px"></div>';document.body.append(wrapper)`
    )
    await pause()
    assert.equal(
      await win.webContents.executeJavaScript(`document.querySelectorAll('filter').length`),
      1
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('#hidden-wrapper').style.display='block'`
    )
    await pause()
    assert.equal(
      await win.webContents.executeJavaScript(`document.querySelectorAll('filter').length`),
      2,
      'Showing a previously hidden generic wrapper must discover its glass panel'
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('#hidden-wrapper').classList.add('unrelated');document.querySelector('#hidden-wrapper').style.display='none'`
    )
    await pause()
    assert.equal(
      await win.webContents.executeJavaScript(`document.querySelectorAll('filter').length`),
      1
    )
    await win.webContents.executeJavaScript(`document.querySelector('#hidden-wrapper').remove()`)
    await apply({
      ...theme,
      rules: {
        '.ep-glass-probe': {
          'background-image': 'linear-gradient(90deg, rgb(10 20 30), rgb(30 40 50))'
        }
      },
      plugin: {
        ...plugin,
        data: { ...plugin.data, glass: { ...plugin.data.glass, selectors: ['.ep-glass-probe'] } }
      }
    })
    await pause()
    assert.match(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.probe')).backgroundImage`
      ),
      /linear-gradient/,
      'The baked edge layer must preserve authored backgrounds'
    )
    await apply({
      ...theme,
      rules: {
        '.ep-glass-probe': {
          'background-image': 'linear-gradient(90deg, rgb(60 70 80), rgb(90 100 110))'
        }
      },
      plugin: {
        ...plugin,
        data: { ...plugin.data, glass: { ...plugin.data.glass, selectors: ['.ep-glass-probe'] } }
      }
    })
    await pause()
    assert.match(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.probe')).backgroundImage`
      ),
      /60, 70, 80/,
      'Same-configuration theme updates must refresh the authored background'
    )
    await apply(null)
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('[id^="ep-theme-glass"],#ep-custom-theme').length`
      ),
      0,
      'Removal clears SVG and styles'
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.probe')).backdropFilter`
      ),
      'none'
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('[class*="ep-theme-glass-"]').length`
      ),
      0,
      'Cleanup removes private surface classes'
    )

    // Real Vue controls, Headless UI teleport, focus handling, typing and close/unmount.
    const componentStyles = []
    let componentId = 0
    const uiBundle = await esbuild.build({
      stdin: {
        contents: `export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {default as Dialog} from './src/renderer/src/components/ui/BaseDialog.vue';export {default as Menu} from './src/renderer/src/components/ui/BaseMenu.vue';export {default as Button} from './src/renderer/src/components/ui/BaseButton.vue';export {default as Input} from './src/renderer/src/components/ui/BaseInput.vue';`,
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'GlassUI',
      alias: {
        '@': path.resolve('src/renderer/src'),
        vue: require.resolve('vue/dist/vue.esm-bundler.js')
      },
      define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      plugins: [
        {
          name: 'glass-ui',
          setup(build) {
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              const id = 'glass-ui-' + ++componentId
              for (const style of descriptor.styles)
                componentStyles.push(
                  compileStyle({
                    source: style.content,
                    filename,
                    id: 'data-v-' + id,
                    scoped: style.scoped
                  }).code
                )
              return {
                contents:
                  compileScript(descriptor, {
                    id,
                    inlineTemplate: true,
                    genDefaultAs: '__sfc__',
                    fs: {
                      fileExists: fs.existsSync,
                      readFile: (file) => fs.readFileSync(file, 'utf8')
                    }
                  }).content + `\n__sfc__.__scopeId="data-v-${id}";export default __sfc__;`,
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    const productionCSS = fs
      .readdirSync('out/renderer/assets')
      .find((name) => /^main-.*\.css$/.test(name))
    assert(productionCSS, 'Build production CSS before this integration check')
    const css =
      fs.readFileSync(path.join('out/renderer/assets', productionCSS), 'utf8') +
      '\n' +
      componentStyles.join('\n')
    await win.webContents.executeJavaScript(
      `document.head.querySelector('style').remove();document.body.style.background='#213147';document.body.innerHTML='<div id="app" style="padding:40px"></div>';document.documentElement.classList.add('reduce-motion');const componentCSS=document.createElement('style');componentCSS.textContent=${JSON.stringify(css)};document.head.append(componentCSS)`
    )
    // Headless UI transitions need an active frame clock in a hidden Electron window.
    // Use the same hidden-window clock as check-ui-components; optical pixel tests above use native rAF.
    await win.webContents.executeJavaScript(
      `window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=clearTimeout;void 0`
    )
    await win.webContents.executeJavaScript(uiBundle.outputFiles[0].text)
    await apply(theme)
    await win.webContents.executeJavaScript(`
      window.glassControls={open:GlassUI.Vue.ref(false),value:GlassUI.Vue.ref(''),clicks:0};
      const h=GlassUI.Vue.h;
      window.glassApp=GlassUI.Vue.createApp({render:()=>h('div',[
        h(GlassUI.Button,{id:'launch-dialog',onClick:()=>glassControls.open.value=true},()=> 'Open dialog'),
        h(GlassUI.Menu,{teleport:true,appearance:'glass',items:[{label:'Add to queue',value:'queue',onClick:()=>glassControls.clicks++}]},{trigger:()=>h(GlassUI.Button,{id:'launch-menu',variant:'secondary'},()=> 'Open menu')}),
        h(GlassUI.Dialog,{modelValue:glassControls.open.value,'onUpdate:modelValue':v=>glassControls.open.value=v,title:'Liquid Glass',blur:true},{default:()=>h(GlassUI.Input,{id:'glass-input',modelValue:glassControls.value.value,'onUpdate:modelValue':v=>glassControls.value.value=v})})
      ])}).use(GlassUI.createI18n({legacy:false,locale:'en',messages:{en:{common:{close:'Close'}}}}));glassApp.mount('#app');
      document.querySelector('#launch-menu').click();`)
    await pause()
    assert.match(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-menu')).backdropFilter`
      ),
      /url\(/,
      'Real glass menu must use the optical filter despite scoped CSS'
    )
    assert.match(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-menu')).backgroundColor`
      ),
      /0\.12\)/,
      'Scoped menu appearance must preserve the clear theme tint'
    )
    await win.webContents.executeJavaScript(`document.querySelector('[role="menuitem"]').click()`)
    await pause()
    assert.equal(await win.webContents.executeJavaScript(`glassControls.clicks`), 1)
    await win.webContents.executeJavaScript(`document.querySelector('#launch-dialog').click()`)
    const visibleDialog = `(()=>{let el=document.querySelector('.ep-dialog-panel');if(!el||!el.getBoundingClientRect().width)return false;for(;el;el=el.parentElement){const s=getComputedStyle(el);if(Number(s.opacity)<.99||s.visibility==='hidden'||s.display==='none')return false}return true})()`
    for (let attempt = 0; attempt < 20; attempt++) {
      await pause()
      if (await win.webContents.executeJavaScript(visibleDialog)) break
    }
    assert.equal(
      await win.webContents.executeJavaScript(visibleDialog),
      true,
      'Real dialog must be visible after its enter transition'
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-overlay--blur')).backdropFilter`
      ),
      'none',
      'Modal overlay must not blur the backdrop before it reaches the clear glass'
    )
    assert(
      await win.webContents.executeJavaScript(
        `document.querySelector('.ep-dialog-panel').getBoundingClientRect().width>0`
      )
    )
    assert.match(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-dialog-panel')).backdropFilter`
      ),
      /url\(/
    )
    await win.webContents.executeJavaScript(
      `const input=document.querySelector('#glass-input');input.value='music through glass';input.dispatchEvent(new Event('input',{bubbles:true}))`
    )
    assert.equal(
      await win.webContents.executeJavaScript(`glassControls.value.value`),
      'music through glass'
    )
    await pause()
    win.webContents.invalidate()
    await pause()
    fs.writeFileSync(
      path.join(output, 'vue-dialog.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Close"]').click()`
    )
    for (let attempt = 0; attempt < 20; attempt++) {
      await pause()
      if (
        await win.webContents.executeJavaScript(
          `!document.querySelector('.ep-dialog-panel') && !document.querySelector('filter')`
        )
      )
        break
    }
    assert.equal(
      await win.webContents.executeJavaScript(`document.querySelectorAll('filter').length`),
      0,
      'Closing real teleported controls releases all filters after the leave transition'
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('#launch-dialog').dispatchEvent(new Event('input',{bubbles:true}))`
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.documentElement.hasAttribute('data-ep-glass-busy')`
      ),
      true
    )
    await win.webContents.executeJavaScript(`glassApp.unmount()`)
    await apply(null)
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.documentElement.hasAttribute('data-ep-glass-busy')`
      ),
      false,
      'Disposal removes the interaction state and cancels its timer'
    )
    manager.deactivate(manifest.id)
    assert.equal(packages.listThemes().length, 0)
    manager.activate(manifest.id)
    assert.equal(packages.listThemes().length, 1)
    win.destroy()
    console.log(
      `Liquid Glass: install, refraction (${changed} pixels), dispersion (${colourPixels} pixels), Fresnel, directional/pointer highlights, padding, resize, late portals, reduced motion, cleanup and reactivation passed. Preview: ${path.join(output, 'preview.png')}`
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
