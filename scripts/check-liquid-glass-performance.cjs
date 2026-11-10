/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-glass-perf-')))
app.whenReady().then(async () => {
  try {
    const output = path.resolve('build/themes/liquid-glass')
    fs.mkdirSync(output, { recursive: true })
    const bundle = await esbuild.build({
      stdin: {
        contents: "export {applyCustomTheme} from './src/renderer/src/services/customTheme'",
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Glass'
    })
    const theme = JSON.parse(fs.readFileSync('docs/themes/liquid-glass/theme.json', 'utf8'))
    const win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 900,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    const rows = Array.from(
      { length: 200 },
      (_, i) =>
        `<div class="song-row"><span>${i + 1} &nbsp; Reflections / Midnight glass</span><button>Play</button></div>`
    ).join('')
    const html = `<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;color:#eaf5ff;font:14px sans-serif;background:repeating-linear-gradient(125deg,#142338 0 45px,#3a617d 46px 48px,#142338 49px 100px)}.library{height:100vh;overflow:auto;padding:80px 30px 100px 260px}.song-row{padding:15px;border-bottom:1px solid #ffffff11;display:flex;justify-content:space-between}.song-row.active{background:#ffffff08}.ep-header{position:fixed;inset:0 0 auto;height:64px;background:#1529420a;padding:20px}.ep-sidebar{position:fixed;left:12px;top:80px;bottom:100px;width:220px;border-radius:20px;background:#1423380a;padding:20px}.ep-footer{position:fixed;bottom:12px;left:12px;right:12px;height:74px;border-radius:22px;background:#1423380f;padding:20px}.ep-dialog-panel{position:fixed;left:500px;top:200px;width:520px;height:240px;border-radius:22px;background:#14233814;padding:24px}.progress{height:3px;background:#a6e8f5}button,input{font:inherit;padding:6px 12px}</style></head><body><div class="library">${rows}</div><header class="ep-header">Easy Player &nbsp; <input id="input" aria-label="Search"></header><aside class="ep-sidebar">Library</aside><footer class="ep-footer">Playback<div class="progress"></div><button id="control">Play / pause</button></footer><div class="ep-dialog-panel">Real-time glass performance<input aria-label="Dialog input"></div></body></html>`
    const filename = path.join(output, 'performance.html')
    fs.writeFileSync(filename, html)
    await win.loadFile(filename)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const config = {
      version: 1,
      name: 'performance',
      tokens: theme.tokens,
      rules: theme.rules,
      plugin: { data: theme }
    }
    const run = async (enabled) => {
      await win.webContents.executeJavaScript(
        `Glass.applyCustomTheme(${enabled ? JSON.stringify(config) : 'null'})`
      )
      await new Promise((resolve) => setTimeout(resolve, 500))
      return win.webContents.executeJavaScript(`(async()=>{
        const metrics={styleWrites:0,lightWrites:0,mapBuilds:0,geometryReads:0,frames:[],inputEvents:0};
        const style=document.querySelector('#ep-theme-glass-style');
        const observer=new MutationObserver(entries=>{for(const e of entries){if(e.target===style)metrics.styleWrites++;if(e.type==='attributes'&&e.target.getAttribute('result')==='normal-dot-half')metrics.lightWrites++}});
        observer.observe(document.head,{childList:true,subtree:true});observer.observe(document.body,{attributes:true,subtree:true,attributeFilter:['values']});
        const originalStyle=window.getComputedStyle;window.getComputedStyle=(el,...args)=>{if(el.matches?.('.ep-header,.ep-footer,.ep-sidebar,.ep-dialog-panel'))metrics.geometryReads++;return originalStyle(el,...args)};
        const originalURL=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...args){metrics.mapBuilds++;return originalURL.apply(this,args)};
        const library=document.querySelector('.library'),rows=[...document.querySelectorAll('.song-row')],progress=document.querySelector('.progress'),input=document.querySelector('#input');
        const onInput=()=>metrics.inputEvents++;input.addEventListener('input',onInput);
        let previous=performance.now();
        for(let frame=0;frame<90;frame++){
          await new Promise(resolve=>requestAnimationFrame(resolve));const now=performance.now();metrics.frames.push(now-previous);previous=now;
          for(let row=0;row<20;row++) rows[(frame+row)%rows.length].classList.toggle('active');
          progress.style.width=(frame%100)+'%';library.scrollTop=frame*7;
          input.value=String(frame);input.dispatchEvent(new Event('input',{bubbles:true}));
        }
        await new Promise(resolve=>requestAnimationFrame(resolve));
        input.removeEventListener('input',onInput);observer.disconnect();window.getComputedStyle=originalStyle;HTMLCanvasElement.prototype.toDataURL=originalURL;
        const fastPath=getComputedStyle(document.querySelector('.ep-header')).backdropFilter.includes('-fast');
        const sorted=metrics.frames.slice(5).sort((a,b)=>a-b);return {...metrics,fastPath,frames:undefined,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)]};
      })()`)
    }
    const plain = await run(false)
    const glass = await run(true)
    const result = { plain, glass }
    const baseline = process.env.EP_GLASS_PERF_BASELINE === '1'
    fs.writeFileSync(
      path.join(output, baseline ? 'performance-before.json' : 'performance-after.json'),
      JSON.stringify(result, null, 2)
    )
    if (!baseline) {
      assert.equal(
        glass.styleWrites,
        0,
        'Unrelated row/progress changes must not rewrite glass CSS'
      )
      assert.equal(glass.lightWrites, 0, 'Static light must not invalidate SVG filters')
      assert.equal(glass.mapBuilds, 0, 'Scrolling must not rebuild geometry')
      assert(glass.geometryReads <= 8, 'Unrelated mutations must not rescan every glass panel')
      assert.equal(glass.inputEvents, 90)
      assert.equal(glass.fastPath, true, 'Scroll/input must use the lightweight cached refraction')
      await new Promise((resolve) => setTimeout(resolve, 250))
      assert.equal(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.ep-header')).backdropFilter.includes('-fast')`
        ),
        false,
        'Idle must restore RGB refraction'
      )
    }
    console.log(JSON.stringify(result, null, 2))
    await win.webContents.executeJavaScript('Glass.applyCustomTheme(null)')
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
