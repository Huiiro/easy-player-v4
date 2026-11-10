/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Isolated Chromium regression fixture. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse } = require('@vue/compiler-sfc')

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-glass-regressions-')))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.whenReady().then(async () => {
  let win
  try {
    const bundle = await esbuild.build({
      stdin: {
        contents: `export {createLiquidGlassEffect} from './src/renderer/src/services/liquidGlass';
          export {createGlassBackground} from './src/renderer/src/services/glassBackground';
          export {mountLiquidGlassStudio} from './src/renderer/src/services/liquidGlassStudio';`,
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Regression',
      alias: { '@': path.resolve('src/renderer/src') },
      plugins: [
        {
          name: 'raw-shaders',
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
    win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    const output = path.resolve('build/themes/liquid-glass-studio')
    fs.mkdirSync(output, { recursive: true })
    const fixture = path.join(output, 'regressions.html')
    fs.writeFileSync(fixture, '<!doctype html><html><head></head><body></body></html>')
    await win.loadFile(fixture)
    const run = (code) => win.webContents.executeJavaScript(code)
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const until = async (expression, message) => {
      for (let i = 0; i < 100; i++) {
        if (await run(expression)) return
        await wait(25)
      }
      throw Error(message)
    }
    await run(bundle.outputFiles[0].text)
    const player = parse(
      fs.readFileSync('src/renderer/src/views/layout/playerPanel/Index.vue', 'utf8')
    )
      .descriptor.styles.map((s) => s.content)
      .join('\n')
    const theme = fs.readFileSync('src/renderer/src/styles/theme.css', 'utf8')
    await run(`{const style=document.createElement('style');style.textContent=${JSON.stringify(theme + '\n' + player)};document.head.append(style);
      document.body.innerHTML='<div style="background:#101416;padding:24px"><button class="panel-tool">Speed</button></div>';
      window.readContrast=()=>{
        const s=getComputedStyle(document.querySelector('button')),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
        const rgb=colour=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=colour;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]};
        const bg=rgb('#101416'),button=rgb(s.backgroundColor),surface=bg.slice(0,3).map((v,i)=>v*(1-button[3]/255)+button[i]*button[3]/255),p=rgb(s.color),ink=surface.map((v,i)=>v*(1-p[3]/255)+p[i]*p[3]/255);
        const lum=colour=>colour.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0),a=lum(ink),b=lum(surface);
        return {colour:s.color,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      };void 0}`)
    const colours = []
    for (const dark of [false, true])
      for (const active of [false, true]) {
        await run(
          `document.documentElement.classList.toggle('dark',${dark});document.documentElement.style.setProperty('--ep-tooltip-text','#000');document.querySelector('button').classList.toggle('active',${active});void 0`
        )
        // Keep transitions out of a computed contrast sample.
        await run(`document.querySelector('button').style.transition='none';void 0`)
        const sample = await run('readContrast()')
        assert(
          sample.contrast >= 4.5,
          'Player buttons retain readable contrast independently of UI mode and tooltip tokens: ' +
            JSON.stringify(sample)
        )
        colours.push({ dark, active, ...sample })
      }
    await run(`document.documentElement.style.removeProperty('--ep-tooltip-text');document.body.innerHTML='';
      for(let i=0;i<6;i++){const element=document.createElement('div');element.className='ep-budget-check';const size=i<4?200:512;element.style.cssText='position:fixed;left:0;top:0;width:'+size+'px;height:'+size+'px;border-radius:24px';document.body.append(element)}
      window.budgetGlass=Regression.createLiquidGlassEffect('ep-budget-check',false,{waitForImages:true,reflection:false,adaptiveQuality:false});
      budgetGlass({selectors:['.ep-budget-check'],blur:0,refraction:20,saturation:1,thickness:24,ior:1.5,dispersion:.2,fresnel:0,highlight:0,shadow:0,interactive:false});
      window.readBudget=()=>({filters:document.querySelectorAll('#ep-budget-check-svg filter').length,active:[...document.querySelectorAll('.ep-budget-check')].filter(e=>getComputedStyle(e).backdropFilter.includes('url(')).length});void 0`)
    await until(
      'readBudget().active===6',
      'Initial six maps did not decode; this check requires accelerated SVG backdrop support'
    )
    const before = await run('readBudget()')
    await run(
      `for(const e of [...document.querySelectorAll('.ep-budget-check')].slice(0,4))e.style.width=e.style.height='512px';void 0`
    )
    await until(
      'readBudget().filters===4&&readBudget().active===4',
      'Exhausted map budget must release both old and pending surplus filters'
    )
    const exhausted = await run('readBudget()')
    await run(
      `for(const e of [...document.querySelectorAll('.ep-budget-check')].slice(0,4))e.style.width=e.style.height='200px';void 0`
    )
    await until(
      'readBudget().active===6&&readBudget().filters===6',
      'Shrinking decoded maps must automatically restore surfaces within the released budget'
    )
    const restored = await run('readBudget()')
    await run('budgetGlass();void 0')

    const recovery = []
    for (const mode of ['empty', 'timeout']) {
      const document = `<!doctype html><html><body style="margin:0"><canvas width="800" height="600"></canvas><script>
        let attempts=0;window.addEventListener('message',async event=>{
          if(event.data?.type!=='glass-frame')return;const port=event.ports[0];
          parent.postMessage({type:'regression-attempt',attempt:++attempts},'*');
          if(attempts===1){if(${JSON.stringify(mode)}==='empty'){port.postMessage(null);port.close()}return}
          const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');ctx.fillStyle='#20ee40';ctx.fillRect(0,0,800,600);
          const bitmap=await createImageBitmap(canvas);port.postMessage(bitmap,[bitmap]);port.close();
        });</script></body></html>`
      await run(`(async()=>{
        document.body.innerHTML='<div class="app-background-stage" style="position:fixed;inset:0;background:#141820"><div class="sandboxed-theme-background ep-app-background" style="position:absolute;inset:0"></div></div><div class="ep-recovery" style="position:fixed;left:200px;top:150px;width:240px;height:160px;border-radius:24px;--ep-studio-blur-radius:0"></div>';
        window.recoveryFrame=document.createElement('iframe');recoveryFrame.sandbox='allow-scripts';recoveryFrame.className='ready';recoveryFrame.style.cssText='width:100%;height:100%;border:0';
        const loaded=new Promise(resolve=>recoveryFrame.onload=resolve);recoveryFrame.srcdoc=${JSON.stringify(document)};document.querySelector('.sandboxed-theme-background').append(recoveryFrame);await loaded;
        window.requests=0;window.collectRequests=event=>{if(event.source===recoveryFrame.contentWindow&&event.data?.type==='regression-attempt')requests=event.data.attempt};window.addEventListener('message',collectRequests);
        window.recoveryGlass=Regression.mountLiquidGlassStudio({selector:'.ep-recovery',id:'ep-recovery'});
      })()`)
      await until(
        'requests>=2',
        'A first ' + mode + ' snapshot must recover automatically without refresh or theme changes'
      )
      await wait(350)
      const attempts = await run('requests')
      assert(attempts <= 8, 'Recovery polling stays bounded by the existing 10fps scheduler')
      await run('recoveryGlass.setActivity(false,false);void 0')
      await wait(50)
      const paused = await run('requests')
      await wait(250)
      assert.equal(await run('requests'), paused, 'Inactive glass must not keep retrying snapshots')
      await run(
        `recoveryGlass.dispose();window.removeEventListener('message',collectRequests);void 0`
      )
      recovery.push({ mode, attempts, paused })
    }
    const metrics = { colours, budget: { before, exhausted, restored }, recovery }
    fs.writeFileSync(path.join(output, 'review-regressions.json'), JSON.stringify(metrics, null, 2))
    console.log(JSON.stringify(metrics, null, 2))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    win?.destroy()
    app.exit(1)
  }
})
