/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-glass-scroll-')))
app.commandLine.appendSwitch('force-device-scale-factor', process.env.EP_GLASS_DPR || '1')
app.whenReady().then(async () => {
  try {
    const output = path.resolve('build/themes/liquid-glass-studio')
    fs.mkdirSync(output, { recursive: true })
    const bundle = await esbuild.build({
      stdin: {
        contents:
          "export {mountLiquidGlassStudio} from './src/renderer/src/services/liquidGlassStudio'",
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Glass',
      plugins: [
        {
          name: 'raw',
          setup(build) {
            build.onResolve({ filter: /\.glsl\?raw$/ }, (args) => ({
              path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
              namespace: 'raw'
            }))
            build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
              contents: fs.readFileSync(args.path, 'utf8'),
              loader: 'text'
            }))
          }
        }
      ]
    })
    const fixture = path.join(output, 'scroll.html')
    fs.writeFileSync(
      fixture,
      `<!doctype html><html style="--color-bg:#142338;--color-text:#f0f6ff"><head><style>
      *{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}.library{height:100vh;overflow:auto;scroll-behavior:auto}.stripes{height:30000px;background:repeating-linear-gradient(to bottom,#ef3044 0 60px,#207bea 60px 120px,#30d558 120px 180px,#e8ce24 180px 240px)}.ep-footer{position:fixed;left:400px;right:20px;bottom:20px;height:120px;border-radius:22px;transition:all .3s}
    </style></head><body><div class="library"><div class="stripes"></div></div><footer class="ep-footer"></footer></body></html>`
    )
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 700,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    await win.loadFile(fixture)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const results = []
    for (const mode of ['plain', 'studio']) {
      await win.webContents.executeJavaScript(
        `window.controller?.dispose();window.controller=undefined;document.querySelector('.library').scrollTop=0;document.querySelector('.ep-footer').style.cssText='';void 0`
      )
      await wait(200)
      if (mode !== 'plain')
        await win.webContents.executeJavaScript(
          `window.controller=Glass.mountLiquidGlassStudio();void 0`
        )
      await wait(500)
      const initial = await win.webContents.executeJavaScript(`(()=>{
        const element=document.querySelector('.ep-footer'),css=getComputedStyle(element);
        const id=css.backdropFilter.match(/#([^"')]+)/)?.[1],filter=id&&document.getElementById(id);
        return {filter:css.backdropFilter,transition:css.transitionProperty,rgbPasses:filter?.querySelectorAll('feDisplacementMap').length??0,blurPasses:filter?.querySelectorAll('feGaussianBlur').length??0};
      })()`)
      const performance = await win.webContents.executeJavaScript(`(async()=>{
        let mapBuilds=0,draws=0,styleWrites=0;const frames=[];
        const originalURL=HTMLCanvasElement.prototype.toDataURL,originalDraw=WebGL2RenderingContext.prototype.drawArrays;
        HTMLCanvasElement.prototype.toDataURL=function(...args){mapBuilds++;return originalURL.apply(this,args)};
        WebGL2RenderingContext.prototype.drawArrays=function(...args){draws++;return originalDraw.apply(this,args)};
        const style=document.querySelector('#ep-studio-backdrop-style'),observer=new MutationObserver(records=>styleWrites+=records.length);
        if(style)observer.observe(style,{childList:true,subtree:true,characterData:true});
        const library=document.querySelector('.library');let previous=await new Promise(requestAnimationFrame);
        for(let frame=0;frame<90;frame++){const now=await new Promise(requestAnimationFrame);frames.push(now-previous);previous=now;library.scrollTop=frame*9}
        observer.disconnect();HTMLCanvasElement.prototype.toDataURL=originalURL;WebGL2RenderingContext.prototype.drawArrays=originalDraw;
        const sorted=frames.slice(5).sort((a,b)=>a-b);return {medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],mapBuilds,draws,styleWrites};
      })()`)
      const samples = []
      for (let i = 0; i < 24; i++) {
        if (i % 4 === 0)
          win.webContents.sendInputEvent({
            type: 'mouseWheel',
            x: 250,
            y: 250,
            deltaX: 0,
            deltaY: -145,
            canScroll: true,
            hasPreciseScrollingDeltas: false
          })
        await wait(20)
        const image = (await win.webContents.capturePage()).resize({ width: 1000, height: 700 })
        const bytes = image.toBitmap()
        const pixel = (x) => {
          const offset = (620 * 1000 + x) * 4
          return [bytes[offset + 2], bytes[offset + 1], bytes[offset]]
        }
        const left = pixel(200),
          glass = pixel(700)
        const maxDifference = Math.max(...left.map((v, c) => Math.abs(v - glass[c])))
        const state = await win.webContents.executeJavaScript(
          `({scroll:document.querySelector('.library').scrollTop,animations:document.querySelector('.ep-footer').getAnimations().map(a=>a.transitionProperty),filter:getComputedStyle(document.querySelector('.ep-footer')).backdropFilter,busy:document.documentElement.hasAttribute('data-ep-studio-backdrop-busy')})`
        )
        samples.push({ left, glass, maxDifference, ...state })
      }
      const changed = samples.filter((s, i) => i && s.scroll !== samples[i - 1].scroll).length
      await wait(250)
      const idleFilter = await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-footer')).backdropFilter`
      )
      const mismatched = samples.filter((s) => s.maxDifference > 85).length
      const stableFilter =
        samples.every((s) => s.filter === initial.filter) && idleFilter === initial.filter
      assert.equal(
        mismatched,
        0,
        'Footer backdrop must follow the currently displayed scroll content'
      )
      assert.equal(
        stableFilter,
        true,
        'Wheel and idle must use the same material without delayed quality switching'
      )
      if (mode === 'studio') {
        assert.equal(
          performance.mapBuilds,
          0,
          'Scrolling does not regenerate any RGB displacement maps'
        )
        assert.equal(performance.draws, 0, 'Scrolling does not redraw WebGL edges')
        assert.equal(performance.styleWrites, 0, 'Scrolling does not rewrite optical filter CSS')
        assert.equal(initial.rgbPasses, 3, 'Scrolling retains the same live RGB refraction')
        assert.equal(initial.blurPasses, 0, 'Clear glass avoids an extra full-panel Gaussian blur')
        assert(
          !initial.transition.includes('backdrop-filter') &&
            !initial.transition.split(',').includes('all')
        )
        assert(
          samples.every((s) => !s.busy && !s.animations.some((p) => p.includes('backdrop'))),
          'No busy timer or animated optical filter during wheel input'
        )
      }
      results.push({
        mode,
        changed,
        mismatched,
        maxDifference: Math.max(...samples.map((s) => s.maxDifference)),
        stableFilter,
        initial,
        performance,
        samples
      })
    }
    await win.webContents.executeJavaScript('controller?.dispose()')
    assert(
      results[1].performance.p95Ms <= Math.max(40, results[0].performance.p95Ms * 2),
      'Live RGB refraction keeps scrolling within the baseline frame-time budget: ' +
        JSON.stringify(results.map((r) => ({ mode: r.mode, ...r.performance })))
    )
    fs.writeFileSync(
      path.join(output, `scroll-verification-${process.env.EP_GLASS_DPR || '1'}x.json`),
      JSON.stringify(results, null, 2)
    )
    console.log(
      JSON.stringify(
        results.map((result) => ({ ...result, samples: undefined })),
        null,
        2
      )
    )
    assert(
      results.every((r) => r.changed > 0),
      'Real wheel input must scroll the page'
    )
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
