/* eslint-disable @typescript-eslint/no-require-imports -- Electron integration test uses CommonJS. */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript test. */
// electron scripts/check-theme-font-package.cjs
// Optional: EP_THEME_CJK_FONT and EP_THEME_MONO_FONT override the local font files.
const { app, BrowserWindow, protocol, net } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const ts = require('typescript')
const AdmZip = require('adm-zip')

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-font-package-'))
app.setPath('userData', path.join(temporary, 'electron'))
app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])
const compile = (file) =>
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
const shared = {}
const sharedSource = compile('src/shared/themePackage.ts')
vm.runInNewContext(sharedSource, { exports: shared })
const packages = {}
vm.runInNewContext(compile('src/main/service/themePackageService.ts'), {
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
    const cjk = process.env.EP_THEME_CJK_FONT || 'C:/Windows/Fonts/simkai.ttf'
    const mono = process.env.EP_THEME_MONO_FONT || 'C:/Windows/Fonts/consola.ttf'
    if (!fs.existsSync(cjk) || !fs.existsSync(mono))
      throw new Error('Set EP_THEME_CJK_FONT and EP_THEME_MONO_FONT to available TTF files')
    const output = path.resolve('out/theme-font-test')
    fs.mkdirSync(output, { recursive: true })
    const manifest = {
      version: 1,
      id: 'font-test',
      theme: 'theme.json',
      resources: {
        cjk: { type: 'font', path: 'fonts/cjk.ttf', weight: '400' },
        mono: { type: 'font', path: 'fonts/mono.ttf', weight: '400' }
      },
      slots: {
        global: { font: 'cjk' },
        sidebar: { font: 'mono' },
        button: { font: 'mono' },
        dialog: { font: 'cjk' }
      },
      text: { appTitle: '字体测试 · Font Test', homeWelcome: '春江花月夜，音乐随心而动。' }
    }
    const theme = JSON.parse(fs.readFileSync('docs/themes/neon-test.theme.json', 'utf8'))
    theme.name = '中文楷体与等宽字体 · 测试'
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
    zip.addFile('theme.json', Buffer.from(JSON.stringify(theme, null, 2)))
    zip.addFile('fonts/cjk.ttf', fs.readFileSync(cjk))
    zip.addFile('fonts/mono.ttf', fs.readFileSync(mono))
    const archive = path.resolve('out/theme-font-test.theme.zip')
    fs.writeFileSync(archive, zip.toBuffer())
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
    const installed = await packages.importThemePackage(fs.readFileSync(archive))
    const exported = await packages.exportThemePackage(installed.package.id)
    const restored = await packages.importThemePackage(exported)
    for (const file of ['fonts/cjk.ttf', 'fonts/mono.ttf']) {
      assert.deepEqual(
        fs.readFileSync(await packages.resolveThemeResource(installed.package.id, file)),
        fs.readFileSync(await packages.resolveThemeResource(restored.package.id, file))
      )
    }
    protocol.handle('easy-player-media', async (request) => {
      try {
        const url = new URL(request.url)
        if (url.hostname !== 'theme') return new Response(null, { status: 404 })
        const [, id, ...parts] = url.pathname.split('/')
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
      width: 1100,
      height: 740,
      webPreferences: { sandbox: true, backgroundThrottling: false }
    })
    window.webContents.on('console-message', (event) => console.log(event.message))
    await window.loadURL('data:text/html,<html><head></head><body></body></html>')
    const entry = fs.readFileSync('out/theme-validation/renderer/index.html', 'utf8')
    const css = [...entry.matchAll(/href="\.\/(assets\/[^"]+\.css)"/g)]
      .map((match) => fs.readFileSync(path.join('out/theme-validation/renderer', match[1]), 'utf8'))
      .join('\n')
    const renderer = compile('src/renderer/src/services/customTheme.ts')
    const source = JSON.stringify({ ...JSON.parse(installed.source), package: installed.package })
    const report = await window.webContents.executeJavaScript(`(async () => {
      const shared={}; (function(exports){${sharedSource}})(shared);
      const module={}; (function(exports,require){${renderer}})(module,()=>shared);
      const {parseCustomTheme,applyCustomTheme}=module;
      const style=document.createElement('style'); style.textContent=${JSON.stringify(css)}; document.head.append(style);
      document.documentElement.classList.add('dark','reduce-motion');
      document.body.style.cssText='padding:36px;font-size:20px;line-height:1.8';
      document.body.innerHTML='<h1 style="font-size:30px;margin-bottom:18px">中文与区域字体测试</h1><p>Chinese font / 中文楷体：春江花月夜，音乐随心而动。</p><p style="font-family:sans-serif;color:#b8b2c9">默认字体对照：春江花月夜，音乐随心而动。</p><aside class="ep-sidebar" style="margin:20px 0;padding:16px;border-radius:12px"><p>Sidebar / Consolas: WWWW iiii 0123456789</p><button class="ep-sidebar-item">Library 012345</button></aside><button class="ep-button ep-button--primary" style="padding:10px 22px">Play / Consolas 012345</button><section class="ep-dialog-panel" style="margin-top:24px;padding:20px">对话框中文楷体：听见每一个音符。<input style="display:block;margin-top:10px" value="输入框继承全局中文字体" /></section>';
      const check=(ok,label)=>{if(!ok)throw new Error(label)};
      const baseline=getComputedStyle(document.body).fontFamily;
      const theme=parseCustomTheme(${JSON.stringify(source)});
      applyCustomTheme(theme);
      const cjk='EPTheme-'+theme.package.id+'-cjk', mono='EPTheme-'+theme.package.id+'-mono';
      const deadline=Date.now()+6000;
      while(![cjk,mono].every((family)=>[...document.fonts].some((face)=>face.family===family&&face.status==='loaded'))){
        check(Date.now()<deadline,'both packaged fonts load'); await new Promise((resolve)=>setTimeout(resolve,20));
      }
      check(getComputedStyle(document.body).fontFamily.includes(cjk),'global Chinese font');
      check(getComputedStyle(document.querySelector('.ep-button')).fontFamily.includes(mono),'button region font');
      check(getComputedStyle(document.querySelector('.ep-sidebar-item')).fontFamily.includes(mono),'sidebar control region font');
      check(getComputedStyle(document.querySelector('.ep-dialog-panel')).fontFamily.includes(cjk),'dialog font');
      check(getComputedStyle(document.querySelector('input')).fontFamily.includes(cjk),'input font');
      const canvas=document.createElement('canvas');canvas.width=700;canvas.height=64;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      const pixels=(font)=>{context.clearRect(0,0,700,64);context.font=font;context.fillText('春江花月夜，音乐随心而动。',0,46);return context.getImageData(0,0,700,64).data};
      const themed=pixels('32px "'+cjk+'"'), fallback=pixels('32px sans-serif');
      let changed=0; for(let i=3;i<themed.length;i+=4)if(themed[i]!==fallback[i])changed++;
      check(changed>100,'Chinese glyphs actually render differently from fallback');
      context.font='24px "'+mono+'"';
      check(Math.abs(context.measureText('iiii').width-context.measureText('WWWW').width)<0.1,'packaged monospace glyphs render');
      const loaded=[...document.fonts].filter((face)=>face.family.startsWith('EPTheme-')).map((face)=>({family:face.family,status:face.status}));
      applyCustomTheme(null);
      check(getComputedStyle(document.body).fontFamily===baseline,'original font restored');
      check(![...document.fonts].some((face)=>face.family===cjk||face.family===mono),'theme fonts unloaded');
      applyCustomTheme(theme);
      const reloadDeadline=Date.now()+6000;
      while(![cjk,mono].every((family)=>[...document.fonts].some((face)=>face.family===family&&face.status==='loaded'))){
        check(Date.now()<reloadDeadline,'font reload after switching');await new Promise((resolve)=>setTimeout(resolve,20));
      }
      await document.fonts.ready;
      return {loaded,changedChinesePixels:changed,checks:['ZIP import','export round-trip bytes','internal resource protocol','Chinese glyph rendering','monospace glyph rendering','global and region assignments','restore and unload','reload']};
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 150))
    fs.writeFileSync(
      path.join(output, 'preview.png'),
      (await window.webContents.capturePage()).toPNG()
    )
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    await packages.removeThemePackage(installed.package.id)
    await packages.removeThemePackage(restored.package.id)
    console.log(JSON.stringify({ archive, ...report }))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    window?.destroy()
    app.exit(1)
  }
})
