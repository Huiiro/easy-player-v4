/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Chromium lifecycle fixture. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-modal-lifecycle-')))
app.whenReady().then(async () => {
  let win
  try {
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `export * as Vue from 'vue';export {createI18n} from 'vue-i18n';
        export {default as Dialog} from './src/renderer/src/components/ui/BaseDialog.vue';
        export {default as Drawer} from './src/renderer/src/components/ui/BaseDrawer.vue';
        export {default as Details} from './src/renderer/src/components/songlist/SongDetailsDialog.vue';
        export {default as Playlists} from './src/renderer/src/components/songlist/AddSongsToPlaylistDialog.vue';
        export {default as Cropper} from './src/renderer/src/components/cropper/CropperDialog.vue';
        export {mountGlassComponentEffects} from './src/renderer/src/services/liquidGlassComponents';
        export {default as zh} from './src/renderer/src/i18n/locales/zh';`,
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Fixture',
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
          name: 'vue-fixture',
          setup(build) {
            let id = 0
            build.onResolve({ filter: /stores\/ui\/uiStore$/ }, () => ({
              path: 'ui',
              namespace: 'mock'
            }))
            build.onResolve({ filter: /components\/ui\/useMessage$/ }, () => ({
              path: 'message',
              namespace: 'mock'
            }))
            build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
              contents:
                args.path === 'ui'
                  ? 'export const useUIStore=()=>({artistSeparator:"/",genreSeparator:"/"})'
                  : 'export const useMessage=()=>({success:()=>{},warning:()=>{},error:message=>window.modalErrors.push(message)})',
              loader: 'js'
            }))
            build.onLoad({ filter: /\.css$/ }, (args) => {
              styles.push(fs.readFileSync(args.path, 'utf8'))
              return { contents: '', loader: 'js' }
            })
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename }),
                scope = 'modal-fixture-' + ++id
              for (const style of descriptor.styles)
                styles.push(
                  compileStyle({
                    source: style.content,
                    filename,
                    id: 'data-v-' + scope,
                    scoped: style.scoped
                  }).code
                )
              return {
                contents:
                  compileScript(descriptor, {
                    id: scope,
                    inlineTemplate: true,
                    genDefaultAs: '__sfc__'
                  }).content +
                  '\n__sfc__.__scopeId="data-v-' +
                  scope +
                  '";export default __sfc__',
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 850,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    const output = path.resolve('build/modal-lifecycle')
    fs.mkdirSync(output, { recursive: true })
    const assets = path.resolve('out/renderer/assets'),
      css = fs.readFileSync(
        path.join(
          assets,
          fs.readdirSync(assets).find((file) => /^main-.*\.css$/.test(file))
        ),
        'utf8'
      )
    const fixture = path.join(output, 'fixture.html')
    fs.writeFileSync(
      fixture,
      `<!doctype html><html><head><style>${css}\n${styles.join('\n')}\n:root{--motion-duration-standard:180ms;--motion-duration-fast:140ms}body{margin:0;background:var(--color-bg);color:var(--color-text)}</style></head><body><button id="launcher">Open</button><div id="app"></div></body></html>`
    )
    await win.loadFile(fixture)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true
    })
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
    })
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const run = (code) => win.webContents.executeJavaScript(code),
      wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const until = async (expression, message) => {
      for (let i = 0; i < 80; i++) {
        if (await run(expression)) return
        await wait(20)
      }
      console.error(
        await run(
          `({events:window.events,errors:window.modalErrors,html:document.body.innerHTML.slice(-5000),visibility:document.visibilityState,focus:document.activeElement.outerHTML,hasFocus:document.hasFocus()})`
        )
      )
      throw Error(message)
    }
    const reports = []
    await run(`window.modalErrors=[];window.modalApp=undefined;window.modalState=undefined;
      window.mountModal=(kind,props={})=>{
        modalApp?.unmount();document.querySelector('#app').innerHTML='';document.querySelector('#launcher').focus();document.querySelector('#launcher').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));window.events=[];
        modalState=Fixture.Vue.reactive({open:true,active:true,veto:false,...props});
        const handlers={'onUpdate:modelValue':value=>{events.push('request');if(!modalState.veto)modalState.open=value},onClose:()=>events.push('close'),onBeforeEnter:()=>events.push('beforeEnter'),onAfterEnter:()=>events.push('afterEnter'),onBeforeLeave:()=>events.push('beforeLeave'),onAfterLeave:()=>events.push('afterLeave')};
        const Child={render:()=>Fixture.Vue.h(Fixture[kind],{modelValue:modalState.open,title:'Lifecycle',...props,...handlers},()=>Fixture.Vue.h('button',{id:'inside'},'Stable content'))};
        modalApp=Fixture.Vue.createApp({render:()=>Fixture.Vue.h(Fixture.Vue.KeepAlive,null,{default:()=>modalState.active?Fixture.Vue.h(Child):null})}).use(Fixture.createI18n({legacy:false,locale:'zh',messages:{zh:Fixture.zh}}));
        modalApp.config.errorHandler=error=>modalErrors.push(String(error));modalApp.mount('#app');
      };void 0`)
    for (const glass of [false, true])
      for (const kind of ['Dialog', 'Drawer']) {
        await run(
          `window.stopGlass?.();window.stopGlass=${glass} ? Fixture.mountGlassComponentEffects():undefined;mountModal(${JSON.stringify(kind)});void 0`
        )
        await until(
          `events.includes('afterEnter')`,
          'Initial open modal must complete the same enter lifecycle as later opens'
        )
        assert.deepEqual(
          await run(`events`),
          ['beforeEnter', 'afterEnter'],
          'Initially open modal has exactly one animated enter cycle'
        )
        assert.equal(
          await run(`document.documentElement.style.overflow`),
          'hidden',
          'Open modal locks page scrolling'
        )
        await run('modalState.open=false;void 0')
        await wait(35)
        assert(
          await run(`!!document.querySelector('#inside')`),
          'Content remains mounted during leave'
        )
        await until(`events.includes('afterLeave')`, 'Leave completes')
        assert.equal(
          await run(`!!document.querySelector('#inside')`),
          false,
          'Leave removes the portal content'
        )
        assert.notEqual(
          await run('document.documentElement.style.overflow'),
          'hidden',
          'Closed modal releases scroll locking'
        )
        await until(
          `document.activeElement.id==='launcher'`,
          'Closing restores the original trigger focus'
        )
        await run(`modalState.open=true;void 0`)
        await until(`events.filter(e=>e==='afterEnter').length===2`, 'Reopen completes enter')
        await run(
          `document.querySelector('#inside').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));document.querySelector('#inside').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));void 0`
        )
        await until(`!document.querySelector('#inside')`, 'Escape closes')
        assert.equal(
          await run(`events.filter(e=>e==='close').length`),
          1,
          'Repeated close requests in one interaction emit close once'
        )
        await run('modalState.open=true;void 0')
        await wait(35)
        await run('modalState.open=false;void 0')
        await wait(35)
        await run('modalState.open=true;void 0')
        await until(
          `events.filter(e=>e==='afterEnter').length>=3&&!!document.querySelector('#inside')&&!document.querySelector('.ep-dialog-panel,.ep-drawer-panel').getAnimations().length`,
          'Interrupted leave returns to a stable open modal'
        )
        assert.equal(await run(`modalState.open`), true)
        await run(`modalState.veto=true;modalState.active=false;void 0`)
        await until(
          `!document.querySelector('#inside')`,
          'Deactivation removes portals even if the parent vetoes its close request'
        )
        assert.notEqual(
          await run('document.documentElement.style.overflow'),
          'hidden',
          'Inactive page cannot retain a modal scroll lock'
        )
        await run('modalApp.unmount();void 0')
        reports.push({
          kind,
          glass,
          initialEnter: true,
          leaveRetention: true,
          focusRestore: true,
          rapidReopen: true,
          deactivation: true
        })
      }
    await run('window.stopGlass?.();window.stopGlass=undefined;void 0')
    await run(`window.loads=[];window.api={database:{command:(type,args)=>new Promise(resolve=>loads.push({type,args,resolve}))}};window.renderBusiness=(kind,extra)=>{
      modalApp?.unmount();window.business=Fixture.Vue.reactive({open:true,...extra});
      modalApp=Fixture.Vue.createApp({render:()=>Fixture.Vue.h(Fixture[kind],{modelValue:business.open,songId:business.songId,songIds:[1],'onUpdate:modelValue':value=>business.open=value})}).use(Fixture.createI18n({legacy:false,locale:'zh',messages:{zh:Fixture.zh}}));modalApp.mount('#app');
    };renderBusiness('Details',{songId:1});void 0`)
    await until('loads.length===1', 'Initial Details loads immediately')
    await run(
      `loads.shift().resolve({success:true,data:{id:1,title:'Keep this title',artist:'Artist',audio:'song.flac'}});void 0`
    )
    await until(
      `document.querySelector('.ep-dialog-panel')?.textContent.includes('Keep this title')`,
      'Details response renders'
    )
    await run('business.open=false;business.songId=null;void 0')
    await wait(35)
    assert(
      await run(
        `document.querySelector('.ep-dialog-panel')?.textContent.includes('Keep this title')`
      ),
      'Details does not replace content with a load-failed page during exit'
    )
    await until(`!document.querySelector('.ep-dialog-panel')`, 'Details leaves')
    await run(`business.open=true;business.songId=2;void 0`)
    await until('loads.length===1', 'New session starts loading')
    await run(`business.open=false;void 0`)
    await wait(25)
    await run(`business.open=true;business.songId=3;void 0`)
    await until('loads.length===2', 'Rapid reopen starts a fresh load')
    await run(
      `loads[1].resolve({success:true,data:{id:3,title:'Newest song',audio:'new.flac'}});loads[0].resolve({success:true,data:{id:2,title:'Stale song',audio:'old.flac'}});loads=[];void 0`
    )
    await until(
      `document.querySelector('.ep-dialog-panel')?.textContent.includes('Newest song')`,
      'Latest Details load wins'
    )
    assert.equal(
      await run(`document.querySelector('.ep-dialog-panel').textContent.includes('Stale song')`),
      false
    )
    await run(`renderBusiness('Playlists',{});void 0`)
    await until('loads.length===1', 'Initially mounted open playlist dialog loads its data')
    await run(
      `loads.shift().resolve({success:true,data:[{id:1,name:'Playlist',cover:null,customCover:null}]});void 0`
    )
    await until(
      `document.querySelector('.ep-dialog-panel')?.textContent.includes('Playlist')`,
      'Playlist data renders'
    )
    await run(
      `[...document.querySelectorAll('.ep-dialog-panel button')].find(e=>e.textContent.includes(Fixture.zh.playlist.createNew)).click();void 0`
    )
    await until(
      `!!document.querySelector('.ep-dialog-panel form input')`,
      'Playlist creation form opens'
    )
    await run('business.open=false;void 0')
    await wait(35)
    assert(
      await run(`!!document.querySelector('.ep-dialog-panel form input')`),
      'Playlist creation form stays present throughout exit'
    )
    await until(`!document.querySelector('.ep-dialog-panel')`, 'Playlist leaves')
    reports.push({
      businessContentRetained: true,
      staleLoadsIgnored: true,
      initialPlaylistLoad: true
    })
    await run(`modalApp.unmount();window.crop=Fixture.Vue.reactive({open:true,url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="green"/></svg>'});
      modalApp=Fixture.Vue.createApp({render:()=>Fixture.Vue.h(Fixture.Cropper,{modelValue:crop.open,imageUrl:crop.url,'onUpdate:modelValue':value=>crop.open=value})}).use(Fixture.createI18n({legacy:false,locale:'zh',messages:{zh:Fixture.zh}}));modalApp.mount('#app');void 0`)
    await until(`!!document.querySelector('.cropper-container')`, 'Cropper initializes after enter')
    await run('window.cropImage=crop.url;crop.open=false;crop.url=null;void 0')
    await wait(35)
    assert(
      await run(`!!document.querySelector('.cropper-container')`),
      'Cropper keeps its rendered image throughout leave'
    )
    await until(`!document.querySelector('.ep-dialog-panel')`, 'Cropper leave completes')
    assert.equal(
      await run(`!!document.querySelector('.cropper-container')`),
      false,
      'Cropper releases its DOM after leave'
    )
    await run('crop.url=window.cropImage;crop.open=true;void 0')
    await until(
      `!!document.querySelector('.cropper-container')`,
      'Cropper reopens with a fresh instance'
    )
    await run('modalApp.unmount();void 0')
    await until(
      `!document.querySelector('[data-headlessui-portal]')`,
      'Direct unmount removes portals'
    )
    assert.notEqual(
      await run('document.documentElement.style.overflow'),
      'hidden',
      'Direct unmount releases scroll locking'
    )
    assert.deepEqual(await run('modalErrors'), [])
    reports.push({ cropperInitAfterEnter: true, cropperDestroyAfterLeave: true })
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(reports, null, 2))
    console.log(JSON.stringify(reports, null, 2))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    win?.destroy()
    app.exit(1)
  }
})
