/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Electron theme integration test. */
const { app, BrowserWindow, protocol, net } = require('electron')
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  vm = require('node:vm')
const { pathToFileURL } = require('node:url'),
  assert = require('node:assert/strict')
const ts = require('typescript'),
  AdmZip = require('adm-zip'),
  { parse, compileScript } = require('vue/compiler-sfc')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-nyan-check-'))
app.setPath('userData', path.join(temporary, 'electron'))
app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
const sharedSource = transpile(fs.readFileSync('src/shared/themePackage.ts', 'utf8'))
const shared = {}
vm.runInNewContext(sharedSource, { exports: shared })
const packages = {}
vm.runInNewContext(transpile(fs.readFileSync('src/main/service/themePackageService.ts', 'utf8')), {
  exports: packages,
  Uint8Array,
  Buffer,
  require: (id) =>
    id === '../utils/pathUtils'
      ? { getDataPath: () => path.join(temporary, 'data') }
      : id === '../../shared/themePackage'
        ? shared
        : require(id)
})
app.whenReady().then(async () => {
  let window
  try {
    const zip = fs.readFileSync('docs/themes/nyan-cat.theme.zip')
    const installed = await packages.importThemePackage(zip)
    const exported = new AdmZip(
      Buffer.from(await packages.exportThemePackage(installed.package.id))
    )
    assert.deepEqual(
      exported.readFile('fonts/OFL.txt'),
      fs.readFileSync('docs/themes/nyan-cat/fonts/OFL.txt')
    )
    protocol.handle('easy-player-media', async (request) => {
      try {
        const url = new URL(request.url),
          [, id, ...parts] = url.pathname.split('/')
        const file = await packages.resolveThemeResource(id, parts.join('/'))
        const response = await net.fetch(pathToFileURL(file).toString())
        const headers = new Headers(response.headers)
        headers.set('Access-Control-Allow-Origin', '*')
        return new Response(response.body, { status: response.status, headers })
      } catch {
        return new Response(null, { status: 404 })
      }
    })
    window = new BrowserWindow({
      show: false,
      width: 1080,
      height: 720,
      webPreferences: { sandbox: true, backgroundThrottling: false }
    })
    window.webContents.on('console-message', (event) => console.log(event.message))
    await window.loadURL('data:text/html,<html><head></head><body></body></html>')
    await window.webContents.executeJavaScript(
      fs.readFileSync('node_modules/vue/dist/vue.global.prod.js', 'utf8')
    )
    const entry = fs.readFileSync('out/theme-validation/renderer/index.html', 'utf8')
    const css = [...entry.matchAll(/href="\.\/(assets\/[^"]+\.css)"/g)]
      .map((match) => fs.readFileSync(path.join('out/theme-validation/renderer', match[1]), 'utf8'))
      .join('\n')
    const renderer = transpile(fs.readFileSync('src/renderer/src/services/customTheme.ts', 'utf8'))
    const descriptor = parse(
      fs.readFileSync('src/renderer/src/components/ui/BaseRange.vue', 'utf8')
    ).descriptor
    const range = transpile(
      compileScript(descriptor, { id: 'nyan-range', inlineTemplate: true }).content
    )
    const source = JSON.stringify({ ...JSON.parse(installed.source), package: installed.package })
    const report = await window.webContents.executeJavaScript(`(async()=>{
      const shared={};(function(exports){${sharedSource}})(shared);
      const themeModule={};(function(exports,require){${renderer}})(themeModule,()=>shared);
      const rangeModule={};(function(exports,require){${range}})(rangeModule,()=>Vue);
      const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);
      const layout=document.createElement('style');layout.textContent='body{font-size:15px;overflow:hidden}.stage{position:relative;height:100vh}.sky{position:absolute;inset:0}.preview-header{position:relative;height:54px;display:flex;align-items:center;padding:0 24px;font-size:20px;border-bottom:1px solid #c298d647}.shell{position:relative;display:flex;height:calc(100vh - 54px)}.preview-sidebar{width:190px;padding:28px 16px}.preview-sidebar button{display:block;width:100%;text-align:left;padding:10px 16px;margin-bottom:8px}.preview-main{flex:1;padding:28px 36px}.subtitle{color:var(--color-text-l);margin-top:10px}.cards{display:flex;gap:18px;margin:20px 0}.album{width:176px}.art{height:132px;border-radius:20px;display:grid;place-items:center;font-family:sans-serif;font-size:54px;margin-bottom:12px}.actions{display:flex;gap:12px}.actions button{padding:9px 22px}.preview-footer{position:absolute;bottom:24px;left:218px;right:28px;padding:16px 24px;border:1px solid var(--app-chrome-border)}.time{display:flex;justify-content:space-between;color:var(--color-text-l);font-size:12px}.dialog-sample{margin-top:18px;width:100%;padding:18px 22px;display:flex;align-items:center;justify-content:space-between}.dialog-sample p{color:var(--color-text-l);font-size:13px;margin-top:6px}';document.head.append(layout);
      document.documentElement.classList.add('dark','reduce-motion');
      document.body.innerHTML='<div class="stage"><div class="ep-app-background sky"></div><header class="ep-header preview-header">Nyan Player <span style="margin-left:auto;font-size:14px;color:#c5b8dc">彩虹糖星球</span></header><div class="shell"><aside class="ep-sidebar preview-sidebar"><p style="margin:0 16px 24px;color:#a090bd">MUSIC SPACE</p><button class="ep-sidebar-item ep-sidebar-item--active">音乐主页</button><button class="ep-sidebar-item">全部歌曲</button><button class="ep-sidebar-item">我的歌单</button><button class="ep-sidebar-item">最近播放</button><button class="ep-sidebar-item">设置</button></aside><main class="ep-home preview-main"><h1 style="font-size:30px">Nyan~ 今天也要开心听歌喵！</h1><p class="subtitle">星星、彩虹，还有你喜欢的旋律。</p><div class="cards"><div class="album"><div class="art" style="background:linear-gradient(135deg,#e9a4ca,#8a79ba)">♫</div>猫咪的太空漫游</div><div class="album"><div class="art" style="background:linear-gradient(135deg,#f1d58f,#cf8dba)">✦</div>收集一口彩虹糖</div><div class="album"><div class="art" style="background:linear-gradient(135deg,#9bd6cc,#8b97cf)">♪</div>今天也很可爱</div></div><div class="actions"><button class="ep-button ep-button--primary">开始播放</button><button class="ep-button ep-button--secondary">收藏歌单</button></div><section class="ep-dialog-panel dialog-sample"><div>一起飞向音乐星球<p>快乐体 · 软糖配色 · 像素猫咪</p></div><button class="ep-button ep-button--primary" style="padding:7px 18px">好耶！</button></section></main></div><footer class="ep-footer preview-footer"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Nyan Cat · Rainbow Mix</span><span>◀  Ⅱ  ▶</span></div><div id="range-host"></div><div class="time"><span>01:32</span><span>03:04</span></div></footer></div>';
      const theme=themeModule.parseCustomTheme(${JSON.stringify(source)});themeModule.applyCustomTheme(theme);
      const state=Vue.reactive({value:50});Vue.createApp({render:()=>Vue.h(rangeModule.default,{value:state.value,min:0,max:100,class:'ep-playback-progress w-full'})}).mount('#range-host');
      const family='EPTheme-'+theme.package.id+'-cute',deadline=Date.now()+5000;
      while(![...document.fonts].some((face)=>face.family===family&&face.status==='loaded')){if(Date.now()>deadline)throw new Error('Cute font did not load');await new Promise((resolve)=>setTimeout(resolve,20))}
      for(const image of ['cat','sky']){const img=new Image();img.src=shared.themeResourceURL(theme.package.id,theme.package.manifest.resources[image].path);await img.decode()}
      const input=document.querySelector('.ep-playback-progress');
      if(!getComputedStyle(input).getPropertyValue('--ep-range-thumb-image').includes('nyan-cat.png'))throw new Error('Cat thumb not assigned');
      window.nyanState=state;window.resetNyan=()=>themeModule.applyCustomTheme(null);
      return {fontLoaded:true,catDecoded:true,licenseRoundTrip:true};
    })()`)
    const output = path.resolve('out/nyan-theme-test')
    fs.mkdirSync(output, { recursive: true })
    for (const value of [0, 50, 100]) {
      await window.webContents.executeJavaScript(`window.nyanState.value=${value};Vue.nextTick()`)
      await new Promise((resolve) => setTimeout(resolve, 100))
      fs.writeFileSync(
        path.join(output, `progress-${value}.png`),
        (await window.webContents.capturePage()).toPNG()
      )
    }
    await window.webContents.executeJavaScript('window.resetNyan()')
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    await packages.removeThemePackage(installed.package.id)
    window.destroy()
    console.log(
      'Nyan theme: import/export, license, cute font, cat image and 0/50/100 progress previews passed'
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    window?.destroy()
    app.exit(1)
  }
})
