/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const Database = require('better-sqlite3')
const baseline = process.argv.includes('--baseline')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-switch-check-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  let db
  try {
    db = new Database(path.join(app.getPath('userData'), 'session.db'))
    db.pragma('journal_mode = WAL')
    db.exec('CREATE TABLE setting(key TEXT PRIMARY KEY, value TEXT)')
    const write = db.prepare('INSERT OR REPLACE INTO setting VALUES(?,?)')
    const writes = []
    const save = (kind, key, value) => {
      const start = performance.now()
      const json = JSON.stringify(value)
      write.run(key, json)
      writes.push({ kind, bytes: Buffer.byteLength(json), mainMs: performance.now() - start })
      return { success: true }
    }
    ipcMain.on('switch-save', (event, key, value) => {
      event.returnValue = save('sync', key, value)
    })
    ipcMain.handle('switch-command', (_event, action, params) =>
      action === 'setSetting'
        ? save('async', params.key, params.value)
        : { success: true, data: [] }
    )
    const mocks = {
      '@/stores/ui/uiStore': `export const useUIStore=()=>({extremePlayback:false,resolvedAppearance:{dark:true,chrome:{}},customBg:{}})`,
      '@/stores/statistics/statisticsStore': `export const useStatisticsStore=()=>({enabled:false,generation:'test',ready:true})`,
      '@/stores/log/logStore': `export const useLogStore=()=>({addEntry(){}})`,
      '@/components/ui/useMessage': `export const useMessage=()=>({warning(){},success(){},info(){}})`,
      '@/stores/persistence': `export function flushPlayerDataStorage(){}`,
      '@/i18n': `export const t=key=>key`,
      '@/services/audioBridge': `let file='';export const audioBridge=new Proxy({
        open:async path=>{file=path;return true},
        getStatus:async()=>({trackInfo:{filePath:file,metadata:{title:file,artist:'Artist'}},durationMs:180000}),
        getReplayGain:async()=>null,
        getAudioChain:async()=>null
      },{get:(target,key)=>target[key]??(async()=>true)})`
    }
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import * as Vue from 'vue';import {createPinia} from 'pinia';import {usePlayerStore} from './src/renderer/src/stores/player/playerStore';export {Vue,createPinia,usePlayerStore};`
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'SwitchCheck',
      write: false,
      define: {
        __APP_VERSION__: '"test"',
        __APP_BUILD__: '"0"',
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      alias: {
        vue: require.resolve('vue/dist/vue.esm-bundler.js'),
        '@': path.resolve('src/renderer/src')
      },
      plugins: [
        {
          name: 'isolated-services',
          setup(build) {
            build.onResolve({ filter: /^@\// }, (args) =>
              args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined
            )
            build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
              contents: mocks[args.path],
              loader: 'js'
            }))
          }
        }
      ]
    })
    const window = new BrowserWindow({
      show: false,
      width: 900,
      height: 650,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false
      }
    })
    const fixture = path.join(app.getPath('userData'), 'fixture.html')
    window.webContents.on('console-message', (event) => {
      if (!event.message.includes('Security Warning')) console.log(event.message)
    })
    fs.writeFileSync(fixture, '<html><body><div id="app"></div></body></html>')
    await window.loadFile(fixture)
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    await window.webContents.executeJavaScript(`
      const {ipcRenderer}=require('electron');
      window.api={database:{saveSync:(key,value)=>ipcRenderer.sendSync('switch-save',key,value),command:(action,params)=>ipcRenderer.invoke('switch-command',action,params)},miniPlayer:{update(){}},system:{updateTray(){}}};
      const {Vue,createPinia,usePlayerStore}=SwitchCheck;
      const app=Vue.createApp({setup(){window.switchPlayer=usePlayerStore();return()=>Vue.h('p',window.switchPlayer.currentQueueSong?.title)}});
      app.use(createPinia());app.mount('#app');
      window.switchWait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=clearTimeout;
      window.switchSongs=Array.from({length:2419},(_,index)=>({id:index+1,title:'Track '+index+' 日本語歌曲标题',artist:'Artist name',album:'Album name',audio:'D:/Fixture/Library/Artist/Album/Track '+index+'.flac',duration:180,cover:'D:/Fixture/covers/'+index+'.jpg',coverAnalysisPath:'D:/Fixture/covers/'+index+'.jpg',coverPrimary:'77 136 220',coverSecondary:'205 78 165',coverLyricsDark:0,coverAnalysisVersion:11,fileName:'Track '+index,isNewest:false,songStatus:1,sourceId:null,createdAt:'2026-10-24T00:00:00Z'}));
      window.switchPlayer.setQueue(window.switchSongs);
      void 0;
    `)
    await window.webContents.executeJavaScript(
      `(async()=>{await window.switchPlayer.playQueueItem(0);await window.switchWait(1100)})()`
    )
    writes.length = 0
    const metrics = await window.webContents.executeJavaScript(`(async()=>{
      const durations=[],gaps=[],longTasks=[];
      const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(task=>task.duration)));
      observer.observe({type:'longtask'});
      let frame=0,last=performance.now();
      function tick(now){gaps.push(now-last);last=now;frame=requestAnimationFrame(tick)}
      frame=requestAnimationFrame(tick);
      await window.switchWait(100);
      for(const index of [1,2,3]){
        const start=performance.now();
        if(!(await window.switchPlayer.playQueueItem(index)))throw Error('switch failed');
        durations.push(performance.now()-start);
        await window.switchWait(100);
      }
      await window.switchWait(1100);
      cancelAnimationFrame(frame);observer.disconnect();
      return {switchMs:durations,maxFrameGapMs:Math.max(...gaps),longTasksMs:longTasks,currentIndex:window.switchPlayer.currentQueueIndex};
    })()`)
    const switchWrites = [...writes]
    const session = JSON.parse(
      db.prepare('SELECT value FROM setting WHERE key=?').get('player.playback-session').value
    )
    assert.equal(session.currentQueueIndex, 3)
    assert.equal(session.queue.length, 2419)
    if (!baseline) {
      assert.equal(
        switchWrites.filter((item) => item.kind === 'sync').length,
        0,
        'track changes never synchronously persist the full queue'
      )
      assert.equal(
        switchWrites.filter((item) => item.kind === 'async').length,
        1,
        'burst switches coalesce into one asynchronous save'
      )
    }
    writes.length = 0
    await window.webContents.executeJavaScript(
      `(async()=>{await window.switchPlayer.playQueueItem(4);window.switchPlayer.savePlaybackSessionSync();await window.switchWait(1100)})()`
    )
    if (!baseline) {
      assert.equal(writes.length, 1, 'explicit flush cancels the pending asynchronous save')
      assert.equal(writes[0].kind, 'sync', 'exit retains an immediate reliable save')
    }
    await window.webContents.executeJavaScript(
      `window.switchPlayer.queue[0].title='Edited queue title';window.switchPlayer.savePlaybackSessionSync();void 0;`
    )
    const edited = JSON.parse(
      db.prepare('SELECT value FROM setting WHERE key=?').get('player.playback-session').value
    )
    assert.equal(
      edited.queue[0].title,
      'Edited queue title',
      'queue snapshot cache invalidates when persisted metadata changes'
    )
    const report = {
      scope:
        'Real Vue player store and SQLite IPC with a 2419-song fixture; excludes decoder, artwork and lyrics rendering',
      baseline,
      ...metrics,
      writes: switchWrites
    }
    const output = path.resolve(
      'build',
      baseline ? 'track-switch-before.json' : 'track-switch-after.json'
    )
    fs.writeFileSync(output, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    window.destroy()
    db.close()
    db = null
    app.exit(0)
  } catch (error) {
    console.error(error)
    db?.close()
    app.exit(1)
  }
})
