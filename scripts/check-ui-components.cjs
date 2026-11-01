/* eslint-disable @typescript-eslint/no-require-imports */
// Hidden Electron integration checks against Chromium's real DOM and focus handling.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-ui-check-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const sfcStyles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `import * as Vue from 'vue'; import { createI18n } from 'vue-i18n';
          import * as UI from './src/renderer/src/components/ui';
          import FloatingPanel from './src/renderer/src/components/ui/FloatingPanel.vue';
          import { floatingPosition } from './src/renderer/src/components/ui/floatingPosition';
          import { fromHex, rgbaToHex, hsvaToRgba } from './src/renderer/src/components/ui/color';
          import AppPageOutlet from './src/renderer/src/components/layout/AppPageOutlet.vue';
          import PlayerPanelTransition from './src/renderer/src/components/layout/PlayerPanelTransition.vue';
          import { createRouter, createMemoryHistory } from 'vue-router';
          import { useEqEditor } from './src/renderer/src/components/player/useEqEditor';
          import { useSongSelection } from './src/renderer/src/components/songlist/useSongSelection';
          import { useCardLibrary } from './src/renderer/src/components/library/useCardLibrary';
          import { useSongActions } from './src/renderer/src/components/songlist/useSongActions';
          import { useFooterSwipe } from './src/renderer/src/components/player/useFooterSwipe';
          import { useSeekProgress } from './src/renderer/src/components/player/useSeekProgress';
          import { useSongActivation } from './src/renderer/src/hooks/useSongActivation';
          import DspEffectEditor from './src/renderer/src/components/player/DspEffectEditor.vue';
          import AudioOutputSettings from './src/renderer/src/components/player/AudioOutputSettings.vue';
          import ImpulseResponseEditor from './src/renderer/src/components/player/ImpulseResponseEditor.vue';
          import LibrarySettings from './src/renderer/src/components/settings/LibrarySettings.vue';
          import DuplicateTaskHost from './src/renderer/src/components/scan/DuplicateTaskHost.vue';
          import GlobalNotifications from './src/renderer/src/components/ui/GlobalNotifications.vue';
          import zh from './src/renderer/src/i18n/locales/zh';
          import eventBus from './src/renderer/src/utils/eventBus';
          import SongDetailsDialog from './src/renderer/src/components/songlist/SongDetailsDialog.vue';
          export { Vue, UI, createI18n, FloatingPanel, floatingPosition, fromHex, rgbaToHex, hsvaToRgba, AppPageOutlet, PlayerPanelTransition, createRouter, createMemoryHistory, useEqEditor, useSongSelection, useCardLibrary, useSongActions, useFooterSwipe, useSeekProgress, useSongActivation, DspEffectEditor, AudioOutputSettings, ImpulseResponseEditor, LibrarySettings, SongDetailsDialog, GlobalNotifications, DuplicateTaskHost, eventBus, zh };`,
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'Checks',
      write: false,
      define: {
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
          name: 'vue-sfc',
          setup(build) {
            build.onResolve({ filter: /[\\/]stores[\\/]ui[\\/]uiStore(?:\.ts)?$/ }, () => ({
              path: 'ui-store',
              namespace: 'activation-test'
            }))
            build.onLoad({ filter: /.*/, namespace: 'activation-test' }, () => ({
              contents: 'export const useUIStore = () => globalThis.__activationUi',
              loader: 'js'
            }))
            build.onResolve({ filter: /[\\/]stores[\\/]player[\\/]playerStore(?:\.ts)?$/ }, () => ({
              path: 'player-store',
              namespace: 'ui-test'
            }))
            build.onLoad({ filter: /.*/, namespace: 'ui-test' }, () => ({
              contents: 'export const usePlayerStore = () => globalThis.__uiPlayer',
              loader: 'js'
            }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              descriptor.styles.forEach((style) =>
                sfcStyles.push(
                  style.src
                    ? fs.readFileSync(
                        style.src.startsWith('@/')
                          ? path.resolve('src/renderer/src', style.src.slice(2))
                          : path.resolve(path.dirname(filename), style.src),
                        'utf8'
                      )
                    : style.content
                )
              )
              return {
                contents: compileScript(descriptor, { id: filename, inlineTemplate: true }).content,
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    const window = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true }
    })
    window.webContents.on('console-message', (event) => {
      if (/warn|error/i.test(event.message)) console.log(event.message)
    })
    const fixture = path.join(app.getPath('userData'), 'fixture.html')
    fs.writeFileSync(fixture, '<html><body></body></html>')
    await window.loadFile(fixture)
    await window.webContents.executeJavaScript(
      'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16); window.cancelAnimationFrame = clearTimeout; void 0;'
    )
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const cssPath = fs
      .readdirSync('out/renderer/assets')
      .find((file) => /^main-.*\.css$/.test(file))
    const css =
      fs.readFileSync(path.join('out/renderer/assets', cssPath), 'utf8') + sfcStyles.join('\n')
    await window.webContents.executeJavaScript(
      `const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);`
    )
    const results = await window.webContents.executeJavaScript(`(async () => {
      const { Vue, UI, createI18n, FloatingPanel, floatingPosition, fromHex, rgbaToHex, hsvaToRgba, AppPageOutlet, PlayerPanelTransition, createRouter, createMemoryHistory, useEqEditor, useSongSelection, useCardLibrary, useSongActions, useFooterSwipe, useSeekProgress, useSongActivation, DspEffectEditor, AudioOutputSettings, ImpulseResponseEditor, LibrarySettings, SongDetailsDialog, GlobalNotifications, DuplicateTaskHost, eventBus } = Checks;
      const { createApp, h, reactive, nextTick, onMounted, onActivated } = Vue;
      const results = [];
      function check(value, message) { if (!value) throw new Error(message); results.push(message); }
      const wait = async (ms = 100) => { await nextTick(); await new Promise(resolve => setTimeout(resolve, ms)); };
      let activeApp;
      async function mount(component, props = {}, slots) {
        activeApp?.unmount(); document.body.innerHTML = '<div id="app"></div>';
        const state = reactive(props);
        activeApp = createApp({ render: () => h(component, state, slots) });
        activeApp.use(createI18n({ legacy:false, locale:'en', missingWarn:false, fallbackWarn:false, messages:{ en:{ settings:{autoImportSongsAdded:'Automatically imported {count} new songs'}, common:{close:'Close',cancel:'Cancel'}, ui:{clear:'Clear',selectPlaceholder:'Select',empty:'Empty',color:'Color',colorValue:'Color value',presets:'Presets',hue:'Hue',saturation:'Saturation',brightness:'Brightness',alpha:'Opacity'} } } }));
        activeApp.mount('#app'); await wait(); return state;
      }
      window.__activationUi=reactive({songPlayTrigger:'double'});
      let songPlays=0;
      const activation=useSongActivation();
      const activate=event=>activation(event,()=>songPlays++);
      await mount({render:()=>h('div',{id:'song-row',onClick:activate,onDblclick:activate},[h('span',{id:'song-title'},'Song'),h('button',{id:'song-action'},'Remove'),h('input',{type:'checkbox'})])});
      const title=document.querySelector('#song-title');
      const mouse=(target,type,detail)=>target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,detail}));
      mouse(title,'click',1);mouse(title,'click',2);
      check(songPlays===0,'Default song activation ignores both clicks before a double click');
      mouse(title,'dblclick',2);check(songPlays===1,'Default song activation plays once on double click');
      window.__activationUi.songPlayTrigger='single';
      mouse(title,'click',1);mouse(title,'click',2);mouse(title,'dblclick',2);
      check(songPlays===2,'Single click activation takes effect immediately and ignores repeated double click events');
      for(const target of [document.querySelector('#song-action'),document.querySelector('input')]) {
        mouse(target,'click',1);mouse(target,'dblclick',2);
      }
      check(songPlays===2,'Song row controls never trigger playback through bubbling');
      window.__activationUi.songPlayTrigger='double';mouse(title,'click',1);
      check(songPlays===2,'Switching back to double click restores the original interaction');
      document.querySelector('#song-row').click();check(songPlays===3,'Keyboard-style button activation remains immediate');
      let clicks = 0;
      let state = await mount(UI.BaseButton, { loading:true, onClick:() => clicks++ }, () => 'Save');
      document.querySelector('button').click(); check(clicks === 0 && document.querySelector('button').disabled, 'loading button blocks activation');
      state.loading = false; await wait(); document.querySelector('button').click(); check(clicks === 1, 'button restores activation');
      for(const [size,height] of [['xs',24],['sm',28],['md',32],['lg',40]]) {
        const dimensions=[];
        for(const control of [UI.BaseButton,UI.BaseInput,UI.BaseSelect]) {
          await mount(control,{size,modelValue:'',options:[]},()=> 'Control');
          dimensions.push(document.querySelector('.ep-button,.ep-input,.ep-select').getBoundingClientRect().height);
        }
        check(dimensions.every(value=>Math.abs(value-height)<0.5),'shared '+size+' geometry matches across button/input/select');
      }
      document.documentElement.style.setProperty('--ep-control-height-md','44px');
      await mount(UI.BaseInput,{modelValue:'Custom size'});check(document.querySelector('input').getBoundingClientRect().height===44,'control height can be overridden through theme token');
      document.documentElement.style.removeProperty('--ep-control-height-md');
      const longOptions=[{value:'a',label:'An extremely long selected option that must never stretch the surrounding layout'}];
      for(const teleport of [false,true]) {
        await mount(UI.BaseSelect,{modelValue:'a',options:longOptions,class:'w-64',teleport});
        let root=document.querySelector('.ep-select-root'),button=document.querySelector('.ep-select');
        check(Math.abs(root.getBoundingClientRect().width-256)<1 && Math.abs(button.getBoundingClientRect().width-256)<1,'select fixed width reaches native trigger (teleport='+teleport+')');
        button.click();await wait(250);
        check(Math.abs(document.querySelector('.ep-select-options').getBoundingClientRect().width-button.getBoundingClientRect().width)<1,'select dropdown matches trigger width (teleport='+teleport+')');
      }
      await mount(UI.BaseSelect,{modelValue:'a',options:longOptions,class:'w-full'});document.querySelector('#app').style.width='300px';await wait();
      check(document.querySelector('.ep-select').getBoundingClientRect().width===300,'full width select fills constrained container');
      await mount(UI.BaseSelect,{modelValue:'a',options:longOptions,class:'w-1/3'});document.querySelector('#app').style.width='600px';await wait();
      check(Math.abs(document.querySelector('.ep-select').getBoundingClientRect().width-200)<1,'percentage select width stays proportional');
      await mount(UI.BaseSelect,{modelValue:'a',options:longOptions,class:'flex-1 min-w-0'});
      const flex=document.querySelector('#app');flex.style.cssText='display:flex;width:300px';const sibling=document.createElement('div');sibling.style.cssText='width:100px;flex-shrink:0';flex.append(sibling);await wait();
      check(document.querySelector('.ep-select').getBoundingClientRect().width===200,'select shrinks within flex layout despite long label');
      let updates = [];
      state = await mount(UI.BaseInput, { modelValue:0, disabled:true, 'onUpdate:modelValue':v => updates.push(v) });
      check(!document.querySelector('button'), 'disabled input hides clear');
      state.disabled = false; state.readonly = true; await wait(); check(!document.querySelector('button'), 'readonly input hides clear');
      state.readonly = false; await wait(); document.querySelector('button').click(); check(updates[0] === '', 'zero value can be cleared');
      state['aria-label'] = 'Changed label'; await wait(); check(document.querySelector('input').getAttribute('aria-label') === 'Changed label', 'input forwards changing attributes');
      updates = []; let commits = [];
      state = await mount(UI.BaseSlider, { modelValue:0.5, min:0, max:100, step:10, transform:v=>v/100, reverseTransform:v=>v*100, 'onUpdate:modelValue':v=>updates.push(v), onChange:v=>commits.push(v) });
      const slider = document.querySelector('[role=slider]'); slider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
      check(updates[0] === 0.6 && commits[0] === 0.6, 'slider commits transformed value without stale parent state');
      state.disabled = true; await wait(); slider.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})); check(commits.length === 1, 'disabled slider ignores keyboard');
      let seekState,finishSeek;const seeks=[];
      const seekPlayer=reactive({currentFile:'first.wav',durationMs:60000,positionMs:1000,seek:target=>{seeks.push(target);seekPlayer.positionMs=target;return new Promise(resolve=>{finishSeek=()=>resolve(true)})}});
      await mount({setup(){seekState=useSeekProgress(seekPlayer);return()=>h(UI.BaseRange,{min:0,max:seekPlayer.durationMs,value:seekState.displayPositionMs.value,onInput:seekState.previewSeek,onChange:seekState.commitSeek,onPointercancel:seekState.cancelSeek,onBlur:seekState.cancelSeek})}});
      const seekRange=document.querySelector('input[type=range]');
      const previewAt=async value=>{seekRange.value=String(value);seekRange.dispatchEvent(new Event('input',{bubbles:true}));await wait(10)};
      await previewAt(10000);await previewAt(22000);await previewAt(45000);
      check(seeks.length===0 && seekState.displayPositionFormatted.value==='0:45','progress drag updates only local position and time preview');
      seekPlayer.positionMs=1500;await wait();
      check(Number(seekRange.value)===45000,'playback position reports never pull a dragging progress thumb backwards');
      seekRange.dispatchEvent(new Event('change',{bubbles:true}));await wait();
      check(seeks.length===1 && seeks[0]===45000,'progress release sends exactly one seek to the final position');
      seekPlayer.positionMs=1800;await wait();check(Number(seekRange.value)===45000,'progress preview stays stable while seek acknowledgement is pending');
      seekPlayer.positionMs=45000;finishSeek();await wait();seekPlayer.positionMs=46000;await wait();
      check(Number(seekRange.value)===46000,'progress follows playback reports again after the seek completes');
      await previewAt(25000);seekRange.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}));seekRange.dispatchEvent(new Event('change',{bubbles:true}));await wait();
      check(seeks.length===1 && Number(seekRange.value)===46000,'cancelled progress drag never commits a seek');
      await previewAt(30000);seekPlayer.currentFile='second.wav';seekPlayer.positionMs=0;await wait();seekRange.value='30000';seekRange.dispatchEvent(new Event('change',{bubbles:true}));await wait();
      check(seeks.length===1 && Number(seekRange.value)===0,'a drag from the previous track cannot seek the next track');
      await previewAt(5000);seekRange.dispatchEvent(new Event('change',{bubbles:true}));await wait();finishSeek();await wait();
      check(seeks.length===2 && seeks[1]===5000,'progress remains usable after a cancelled track-change gesture');
      state = await mount(UI.BaseColorPicker, {modelValue:'#ff0000',disabled:true});
      document.querySelector('button').click(); await wait(); check(!document.querySelector('.ep-color-picker'),'disabled color picker cannot open');
      const rect = {left:870,right:890,top:650,bottom:680,width:20,height:30};
      const pos = floatingPosition(rect,{width:200,height:150},{width:900,height:700},'bottom','start');
      check(pos.side === 'top' && pos.left === 692 && pos.top === 492, 'floating panel flips and stays inside viewport');
      check(rgbaToHex(hsvaToRgba(fromHex('#ff000080')),true) === '#ff000080', 'color conversion retains alpha');
      let invalid = false; try { fromHex('zzzzzz'); } catch { invalid = true; } check(invalid, 'invalid color is rejected');
      let submenuOpen, submenuAnchorLeft;
      const visibleSubmenuPositions=[];
      await mount({setup(){
        const anchor=Vue.ref(null);submenuOpen=Vue.ref(false);submenuAnchorLeft=Vue.ref(320);
        return()=>h('div',[
          h('button',{ref:anchor,style:{position:'fixed',left:submenuAnchorLeft.value+'px',top:'180px',width:'140px',height:'32px'}},'Flags'),
          submenuOpen.value?h(FloatingPanel,{open:true,anchor:anchor.value,side:'right',align:'start',offset:12,teleport:true},()=>h('div',{style:{width:'200px',height:'100px'}},'Actions')):null
        ]);
      }});
      const submenuObserver=new MutationObserver(()=>{
        const panel=document.querySelector('.ep-floating');
        if(panel && getComputedStyle(panel).visibility==='visible')visibleSubmenuPositions.push(panel.getBoundingClientRect().left);
      });
      submenuObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
      try{
        submenuOpen.value=true;await wait();
        check(visibleSubmenuPositions.length>0 && visibleSubmenuPositions.every(left=>Math.abs(left-472)<1),'submenu is beside its trigger from its first visible position');
        submenuOpen.value=false;await wait();visibleSubmenuPositions.length=0;
        submenuAnchorLeft.value=700;submenuOpen.value=true;await wait();
        check(visibleSubmenuPositions.length>0 && visibleSubmenuPositions.every(left=>Math.abs(left-488)<1),'reopened submenu flips left without flashing at the viewport edge');
      }finally{submenuObserver.disconnect();}
      let shown = 0, hidden = 0;
      state = await mount(UI.BasePopover, {trigger:'hover', teleport:true, offset:20, content:'Panel',onShow:()=>shown++,onHide:()=>hidden++}, {trigger:()=>h('span','Trigger')});
      document.querySelector('.ep-popover-trigger').dispatchEvent(new Event('pointerenter')); await wait();
      check(shown === 1 && !!document.querySelector('.ep-popover'), 'hover popover opens and emits show once');
      check(Math.abs(document.querySelector('.ep-floating').getBoundingClientRect().top-document.querySelector('.ep-popover-trigger').getBoundingClientRect().bottom-20)<2,'popover applies requested offset');
      document.querySelector('.ep-popover-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait(250); check(hidden === 1 && !document.querySelector('.ep-popover'), 'popover Escape closes and emits hide');
      state = await mount(UI.BaseSelect, { modelValue:'a',teleport:true,options:[{label:'Alpha',value:'a'},{label:'Beta',value:'b'},{label:'Disabled',value:'c',disabled:true}] });
      const select = document.querySelector('.ep-select'); select.focus(); select.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); await wait();
      check(!!document.querySelector('[role=listbox]') && document.querySelector('[role=option][aria-disabled=true]'), 'select opens from keyboard and exposes disabled options');
      const floating = document.querySelector('.ep-floating'); const before = floating.getBoundingClientRect().top;
      document.querySelector('#app').style.paddingTop = '100px'; window.dispatchEvent(new Event('resize')); await wait();
      check(Math.abs(floating.getBoundingClientRect().top - before - 100) < 2, 'teleported select follows moved trigger');
      let menuSelection;
      await mount(UI.BaseMenu, {teleport:true,items:[{label:'First',value:'first'},{label:'Disabled',value:'disabled',disabled:true},{label:'Last',value:'last'}],'onUpdate:modelValue':value=>menuSelection=value}, {trigger:()=>h('button',{type:'button'},'Menu')});
      document.querySelector('button').click();await wait();
      check(!!document.querySelector('.ep-menu') && document.querySelector('[role=menuitem][aria-disabled=true]'),'menu renders with disabled item semantics');
      const lastItem=[...document.querySelectorAll('.ep-menu button')].at(-1);lastItem.click();await wait();check(menuSelection==='last','menu item activation updates model');
      let closes = 0;
      state = await mount(UI.BaseDialog, {modelValue:true,title:'Dialog',width:420,closeOnOverlay:false,closeOnEsc:true,'onUpdate:modelValue':()=>closes++}, () => h('button','Inside'));
      await wait(250);
      check(Math.abs(document.querySelector('.ep-dialog-panel').getBoundingClientRect().width - 420) < 2, 'dialog accepts CSS pixel width');
      document.querySelector('.ep-dialog-panel button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); await wait(); check(closes === 1, 'Escape works independently of overlay policy (received '+closes+')');
      state.closeOnEsc = false; await wait(); document.querySelector('.ep-dialog-panel button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); await wait(); check(closes===1,'dialog can independently block Escape');
      let rejectAction; let errors = 0; let closed = false;
      state = await mount(UI.BaseConfirmDialog, {modelValue:true,title:'Confirm',message:'Async',confirmText:'Confirm',confirmAction:()=>new Promise((resolve,reject)=>{rejectAction=reject}),'onUpdate:modelValue':()=>closed=true,onError:()=>errors++});
      document.querySelector('.ep-button--primary').click(); await wait(); check(document.querySelector('.ep-button--primary').disabled && !closed, 'async confirmation remains open while pending');
      rejectAction(new Error('Failed')); await wait(); check(errors === 1 && !closed && !document.querySelector('.ep-button--primary').disabled, 'failed confirmation stays open and can retry');
      const messages = UI.useMessage(); messages.clear(); messages.configure({max:2});
      const first = messages.add({message:'Same',dedupeKey:'same',duration:0}); check(messages.add({message:'Same',dedupeKey:'same'}) === first, 'messages deduplicate by explicit key');
      let removals = 0; messages.add({message:'Second',duration:30,onClose:()=>removals++}); messages.clear(); await wait(60); check(messages.messages.value.length === 0 && removals === 1, 'message removal clears timers and invokes close once');
      let selection;
      window.__activationUi=reactive({autoImportLocalMusic:true,showAutoImportNotifications:true});
      let onAutoImport,autoImportUnsubscribed=0,autoImportRefreshes=0;
      window.api={library:{onAutoImported:callback=>{onAutoImport=callback;return()=>{autoImportUnsubscribed++;onAutoImport=undefined;}}}};
      const onAutoImportRefresh=()=>autoImportRefreshes++;
      eventBus.on('scanFinished',onAutoImportRefresh);
      await mount(GlobalNotifications);
      onAutoImport({directory:'music-a',added:2});onAutoImport({directory:'music-b',added:3});
      await wait(1100);
      check(autoImportRefreshes===2,'automatic import refreshes the library from any page');
      check(messages.messages.value.length===1 && messages.messages.value[0].message==='Automatically imported 5 new songs','global automatic import notification combines counts across folders');
      check(document.querySelector('[role=status]')?.textContent.includes('Automatically imported 5 new songs'),'automatic import result is rendered by the global message component');
      messages.clear();
      window.__activationUi.showAutoImportNotifications=false;await wait();
      onAutoImport({directory:'music-a',added:1});await wait(1100);
      check(autoImportRefreshes===3 && messages.messages.value.length===0,'turning off reminders preserves automatic library refresh');
      window.__activationUi.showAutoImportNotifications=true;await wait();
      onAutoImport({directory:'music-a',added:0});await wait(1100);
      check(messages.messages.value.length===0,'empty import results do not notify');
      onAutoImport({directory:'music-a',added:4});window.__activationUi.autoImportLocalMusic=false;
      await wait(1100);
      check(messages.messages.value.length===0,'disabling monitoring cancels pending reminders');
      window.__activationUi.autoImportLocalMusic=true;await wait();
      onAutoImport({directory:'music-a',added:4});
      await mount({setup(){selection=useSongSelection(Vue.ref([{id:1,isNewest:true},{id:2}]));return()=>h('p','Selection');}});
      await wait(1100);
      check(autoImportUnsubscribed===1 && messages.messages.value.length===0,'global notifications clean up IPC subscriptions and pending timers on unmount');
      eventBus.off('scanFinished',onAutoImportRefresh);
      selection.toggleSelection();selection.toggleAll();check(selection.allSelected.value && selection.selectedIds.value.size===2,'song selection selects visible collection');
      selection.selectNewest();check(selection.selectedIds.value.has(1) && !selection.selectedIds.value.has(2),'newest selection preserves filtering');
      selection.toggleSelection();check(selection.selectedIds.value.size===0,'leaving selection mode clears selected IDs');
      let editor;const eqSection=Vue.ref('eq');
      const eqPlayer=reactive({eqBands:[{frequencyHz:100,gainDb:0,q:1,enabled:false},{frequencyHz:1000,gainDb:0,q:1,enabled:false}],commitEqBands:async()=>true,refreshAudioChain:async()=>{}});
      await mount({setup(){editor=useEqEditor(eqPlayer,{allPresets:[]},eqSection);return()=>h('p','EQ');}});
      editor.updateEqBand(0,{gainDb:6});editor.commitEq();editor.undoEq();check(eqPlayer.eqBands[0].gainDb===0,'EQ undo restores snapshot');
      editor.redoEq();check(eqPlayer.eqBands[0].gainDb===6,'EQ redo restores committed edit');
      editor.toggleEqComparison();check(eqPlayer.eqBands[0].gainDb===0,'EQ comparison auditions prior band');
      eqSection.value='output';await wait();check(eqPlayer.eqBands[0].gainDb===6 && !editor.eqComparison.value,'leaving EQ comparison restores current settings');
      let library;const requests=[];
      window.api={database:{command:()=>new Promise(resolve=>requests.push(resolve))}};
      await mount({setup(){library=useCardLibrary({beforeLoad(){},onSongsLoaded:async()=>{},onPlaylistsLoaded:async()=>{},reduceMotion:()=>true});return()=>h('p','Cards');}});
      const oldLoad=library.loadSongs();const newLoad=library.loadSongs();
      requests[1]({success:true,data:{data:[{id:2,songStatus:1}]}});await newLoad;
      requests[0]({success:true,data:{data:[{id:1,songStatus:1}]}});await oldLoad;
      check(library.songs.value[0].id===2,'late carousel query cannot overwrite newer collection');
      let songActions,refreshes=0;const mutations=[];
      const actionProps=reactive({source:{type:'playlist',id:12},songs:[{id:1,sourceId:null,title:'One'},{id:3,sourceId:null,title:'Three'}],selectedIds:new Set([1,3]),refresh:async()=>refreshes++,playSong:async()=>{}});
      window.__uiPlayer=reactive({queue:[{id:1},{id:2},{id:3}],removeQueueItem:async function(index){this.queue.splice(index,1)}});
      window.api.database.command=async(action,params)=>{mutations.push({action,params});return {success:true}};
      await mount({setup(){songActions=useSongActions(actionProps,()=>{actionProps.selectedIds=new Set()});return()=>h('p','Song actions');}});
      songActions.requestDeleteSelectedSongs();check(songActions.songsPendingDelete.value.length===2 && window.__uiPlayer.queue.length===3,'delete action waits for dialog confirmation');
      await songActions.onSongsDeleted([1,3]);check(window.__uiPlayer.queue.length===1 && window.__uiPlayer.queue[0].id===2 && actionProps.selectedIds.size===0 && refreshes===1,'confirmed deletion updates queue, selection and collection');
      await songActions.removeSongsFromCurrentPlaylist([2]);check(mutations[0].action==='removeSongsFromPlaylist' && mutations[0].params.playlistId===12,'playlist action retains source collection identity');
      const preferences=[];
      actionProps.songs=[{id:1,sourceId:null,title:'One',preference:0},{id:3,sourceId:null,title:'Three',preference:1},{id:4,sourceId:null,title:'Four',preference:0}];
      actionProps.selectedIds=new Set([1,3]);
      window.__uiPlayer.setPreferences=async(ids,preference)=>{preferences.push({ids:[...ids],preference});return true};
      window.__uiPlayer.setPreference=async(id,preference)=>{preferences.push({ids:[id],preference});return true};
      await songActions.openMenu(actionProps.songs[0],10,10);songActions.openSongTags();
      actionProps.selectedIds=new Set([4]);
      check(songActions.batchTagDialogOpen.value && songActions.batchTagSongIds.value.join(',')==='1,3','right-click batch tag editor snapshots selected song IDs');
      actionProps.selectedIds=new Set([1,3]);
      await songActions.openMenu(actionProps.songs[0],10,10);await songActions.setActiveMenuSongPreference(1);
      check(preferences.at(-1).ids.join(',')==='1,3' && preferences.at(-1).preference===1,'right-click liking a selected row updates the selected songs');
      await songActions.openMenu(actionProps.songs[2],10,10);await songActions.setActiveMenuSongPreference(-1);
      check(preferences.at(-1).ids.join(',')==='4','right-clicking outside the selection keeps preference edits on that song');
      await songActions.setLyricFlag('instrumental',true);
      check(mutations.at(-1).action==='setSongsLyricFlags' && mutations.at(-1).params.songIds.join(',')==='1,3' && mutations.at(-1).params.patch.instrumental===true,'multi-select adds lyric markers in a single batch');
      await songActions.setLyricFlag('disableNetwork',false);
      check(mutations.at(-1).params.patch.disableNetwork===false,'multi-select can remove network lyric markers');
      let swipe;const navigations=[];const collapsed=Vue.ref(true),reduced=Vue.ref(true);
      const swipePlayer=reactive({queue:[{id:1},{id:2},{id:3}],currentQueueSong:{id:2},currentQueueIndex:1,playMode:0,shuffleNavigationRevision:0,getPreviousQueueIndex:()=>0,getNextQueueIndex:()=>2,playPrevious:async()=>navigations.push('previous'),playNext:async index=>navigations.push(index)});
      await mount({setup(){swipe=useFooterSwipe(swipePlayer,collapsed,reduced);return()=>h('p','Swipe');}});
      const pointer=(x,y=0)=>({isPrimary:true,button:0,pointerId:1,clientX:x,clientY:y,currentTarget:null});
      swipe.handleSwipePointerDown(pointer(200));swipe.handleSwipePointerMove(pointer(100));swipe.handleSwipePointerUp(pointer(100));await wait();check(navigations[0]===2,'collapsed footer swipe selects precomputed next queue item');
      swipe.handleSwipePointerDown(pointer(200));swipe.handleSwipePointerMove(pointer(100));swipe.handleSwipePointerCancel(pointer(100));await wait();check(navigations.length===1,'cancelled swipe never changes track');
      collapsed.value=false;swipe.handleSwipePointerDown(pointer(200));swipe.handleSwipePointerMove(pointer(100));swipe.handleSwipePointerUp(pointer(100));await wait();check(navigations.length===1,'expanded footer ignores collapsed gestures');
      const effectCalls=[];
      window.__uiPlayer=reactive({compressorConfig:{thresholdDb:-20,ratio:4,attackMs:10,releaseMs:100,kneeDb:3,makeupDb:0},limiterConfig:{enabled:true,ceilingDb:-1,releaseMs:50},setCompressorConfig:async()=>{effectCalls.push('compressor');return true},setLimiter:async()=>{effectCalls.push('limiter');return true},refreshAudioChain:async()=>{}});
      state=await mount(DspEffectEditor,{effect:'compressor'});document.querySelector('[role=slider]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await wait();
      check(window.__uiPlayer.compressorConfig.thresholdDb>-20 && effectCalls[0]==='compressor','DSP compressor field commits to its own processing node');
      state.effect='limiter';await wait();document.querySelector('[role=slider]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await wait();
      check(Math.abs(window.__uiPlayer.limiterConfig.ceilingDb+0.9)<0.001 && effectCalls.at(-1)==='limiter','switching DSP node routes field edits to the new schema');
      let selectedBackend;
      window.__uiPlayer=reactive({devices:[{backend:'asio',id:'same',name:'ASIO device'},{backend:'wasapi_shared',id:'same',name:'WASAPI device'}],currentBackend:'asio',currentDeviceId:'same',volume:0.5,selectOutputDevice:async device=>{selectedBackend=device.backend;return true},refreshAudioChain:async()=>{},refreshDevices:async()=>{}});
      await mount(AudioOutputSettings);document.querySelector('.ep-select').click();await wait();document.querySelectorAll('[role=option]')[1].click();await wait();
      check(selectedBackend==='wasapi_shared','output selector distinguishes identical device IDs across backends');
      let irFailure,irCleared=0;
      window.__uiPlayer=reactive({impulseResponseConfig:{path:'original.wav',enabled:false,gainDb:0,autoGain:true},setImpulseResponseConfig:async()=>({success:false,error:'unsupported'}),loadImpulseResponseConfig:async()=>{}});
      window.api.audio={getFilePath:()=> 'new.wav'};
      await mount(ImpulseResponseEditor,{error:'',onLoadError:code=>irFailure=code,onClearError:()=>irCleared++});
      const importIr=async()=>{const data=new DataTransfer();data.items.add(new File(['test'],'new.wav',{type:'audio/wav'}));const input=document.querySelector('input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));await wait();};
      await importIr();check(window.__uiPlayer.impulseResponseConfig.path==='original.wav' && irFailure==='unsupported','failed impulse import restores previous config and reports error');
      window.__uiPlayer.setImpulseResponseConfig=async()=>({success:true});await importIr();check(window.__uiPlayer.impulseResponseConfig.path==='new.wav' && irCleared===1,'successful impulse import commits new config and clears error');
      activeApp.unmount(); document.body.innerHTML = '<div id="app"></div>';
      let aMounts=0, aActivations=0;
      const A={setup(){onMounted(()=>aMounts++);onActivated(()=>aActivations++);return()=>[h('p','A'),h('p','Fragment root')];}};
      const B={render:()=>h('p','B')};
      const router=createRouter({history:createMemoryHistory(),routes:[{path:'/a',component:A},{path:'/b',component:B,meta:{keepAlive:false}}]});
      await router.push('/a'); await router.isReady(); activeApp=createApp({render:()=>h(AppPageOutlet,{transition:'none'})});activeApp.use(router);activeApp.mount('#app');await wait();
      document.querySelector('.ep-page').dataset.marker='retained';
      await router.push('/b');await wait();await router.push('/a');await wait();
      check(aMounts===1 && aActivations===2 && document.querySelector('.ep-page').dataset.marker==='retained','page cache survives visits to uncached routes and supports fragment pages');
      await router.push('/a?q=search');await wait();check(aMounts===1,'search query changes preserve page instance');
      document.documentElement.classList.add('reduce-motion');await wait();
      check(getComputedStyle(document.querySelector('.ep-page')).transitionDuration==='0s','reduced motion disables page transitions');
      document.documentElement.classList.remove('reduce-motion');
      let panelMounts=0,panelDisposals=0;
      const hiddenAtDisposal=[];
      const CanvasPanel={setup(){
        const canvas=Vue.ref();panelMounts++;
        Vue.onBeforeUnmount(()=>{
          panelDisposals++;
          hiddenAtDisposal.push(getComputedStyle(canvas.value.closest('.player-panel-layer')).display==='none');
          canvas.value.width=1;canvas.value.height=1;
        });
        return()=>h('canvas',{ref:canvas,width:800,height:600,'data-player-canvas':''});
      }};
      state=await mount(PlayerPanelTransition,{open:false},()=>h(CanvasPanel));
      check(panelMounts===0,'closed player never mounts visual resources');
      state.open=true;await wait(300);
      let playerCanvas=document.querySelector('[data-player-canvas]');
      check(panelMounts===1 && playerCanvas.width===800,'opening player lazily mounts its canvas');
      state.open=false;await wait(70);
      const leavingLayer=document.querySelector('.player-panel-layer');
      check(panelDisposals===0 && playerCanvas.width===800 && playerCanvas.isConnected,'player canvas retains its rendered frame throughout leave');
      check(Number(getComputedStyle(leavingLayer).opacity)>0 && Number(getComputedStyle(leavingLayer).opacity)<1 && leavingLayer.inert,'player fades smoothly and blocks interaction while leaving');
      await wait(300);
      check(panelDisposals===1 && !playerCanvas.isConnected && hiddenAtDisposal.every(Boolean),'player releases visual resources only after the host is hidden');
      state.open=true;await wait(300);playerCanvas=document.querySelector('[data-player-canvas]');
      state.open=false;await wait(70);state.open=true;await wait(300);
      check(panelMounts===2 && panelDisposals===1 && playerCanvas===document.querySelector('[data-player-canvas]') && playerCanvas.width===800,'reopening during leave preserves the existing canvas');
      state.open=false;await wait(300);
      check(panelDisposals===2 && hiddenAtDisposal.every(Boolean),'a cancelled leave does not prevent later cleanup');
      document.documentElement.classList.add('reduce-motion');
      state.open=true;await wait(70);state.open=false;await wait(70);
      check(panelDisposals===3 && !document.querySelector('[data-player-canvas]') && hiddenAtDisposal.every(Boolean),'reduced motion closes immediately without clearing a visible canvas');
      document.documentElement.classList.remove('reduce-motion');
      const metadataFixture={id:1,title:'Metadata fixture',artist:'Singer A;Singer B',album:'Album',genre:'POP,rock',duration:10,fileSize:100,year:null,trackNo:null,diskNo:null};
      window.__activationUi=reactive({albumGroupByName:false,normalizeMetadataSeparator:false,artistSeparator:';',genreSeparator:',',ignoreShortSongs:true,autoImportLocalMusic:true,showAutoImportNotifications:true});
      window.api.files={onImportProgress:()=>()=>{}};
      window.api.database={command:async()=>({success:true,data:metadataFixture})};
      const detailsState=reactive({open:false});
      await mount({render:()=>[h(LibrarySettings),h(SongDetailsDialog,{modelValue:detailsState.open,songId:1,'onUpdate:modelValue':value=>detailsState.open=value})]});
      const monitorSwitch=document.querySelector('[aria-label="settings.autoImportLocalMusic"]');
      const reminderSwitch=document.querySelector('[aria-label="settings.showAutoImportNotifications"]');
      check(monitorSwitch?.getAttribute('aria-checked')==='true' && reminderSwitch?.getAttribute('aria-checked')==='true','library settings expose enabled monitoring and reminder switches');
      monitorSwitch.click();await wait();
      check(window.__activationUi.autoImportLocalMusic===false && reminderSwitch.disabled,'turning off monitoring disables the reminder control');
      reminderSwitch.click();await wait();
      check(window.__activationUi.showAutoImportNotifications===true,'disabled reminder control retains its preference');
      monitorSwitch.click();await wait();reminderSwitch.click();await wait();
      check(window.__activationUi.autoImportLocalMusic===true && window.__activationUi.showAutoImportNotifications===false,'import reminders can be disabled independently of monitoring');
      const albumGroupingRow=[...document.querySelectorAll('.setting-row')].find(row=>row.querySelector('h3')?.textContent==='settings.albumGroupByName');
      check(!!albumGroupingRow && albumGroupingRow.querySelector('[role=switch]').getAttribute('aria-checked')==='false','album grouping setting starts disabled');
      albumGroupingRow.querySelector('[role=switch]').click();await wait();
      check(window.__activationUi.albumGroupByName===true,'album grouping switch updates the shared library preference');
      albumGroupingRow.querySelector('[role=switch]').click();await wait();
      check(window.__activationUi.albumGroupByName===false,'album grouping switch restores artist-based grouping when disabled');
      const normalizationRows=[...document.querySelectorAll('.setting-row')].filter(row=>row.querySelector('h3')?.textContent==='settings.normalizeMetadataSeparator');
      check(normalizationRows.length===1,'library settings expose one shared separator normalization switch');
      normalizationRows[0].querySelector('[role=switch]').click();await wait();
      check(window.__activationUi.normalizeMetadataSeparator===true,'shared separator switch updates the single UI preference');
      detailsState.open=true;await wait();
      check(document.body.textContent.includes('Singer A / Singer B') && document.body.textContent.includes('POP / rock'),'shared switch normalizes both artist and genre in real song details');
      detailsState.open=false;await wait();
      normalizationRows[0].querySelector('[role=switch]').click();await wait();
      detailsState.open=true;await wait();
      check(document.body.textContent.includes('Singer A;Singer B') && document.body.textContent.includes('POP,rock'),'disabling the shared switch restores both original separator styles');
      check(metadataFixture.artist==='Singer A;Singer B' && metadataFixture.genre==='POP,rock','display normalization preserves original song metadata');
      detailsState.open=false;await wait(300);
      let duplicateScans=0,duplicateExports=0,duplicateCleanups=[],duplicateProgressListener,duplicateCacheClears=0,duplicateScanOptions=[],duplicateDeferred=false,duplicateRelease;
      let duplicateTask=null, duplicateReport=null, duplicateRetained=null, duplicateCancels=0, duplicateDetailReads=0, duplicateExportLanguage;
      const duplicateListeners=new Set();
      const publishDuplicate=()=>duplicateListeners.forEach(callback=>callback(structuredClone(duplicateTask)));
      duplicateProgressListener=progress=>{duplicateTask.progress=progress;duplicateTask.revision++;publishDuplicate()};
      let duplicateHostApp, duplicateVisual=false;
      const mountDuplicateHost=async()=>{
        duplicateHostApp?.unmount();
        document.querySelector('#duplicate-host')?.remove();
        const host=document.createElement('div');host.id='duplicate-host';document.body.append(host);
        duplicateHostApp=createApp(DuplicateTaskHost);
        duplicateHostApp.use(createI18n({legacy:false,locale:duplicateVisual?'zh':'en',missingWarn:false,fallbackWarn:false,messages:duplicateVisual?{zh:Checks.zh}:{en:{common:{close:'Close',cancel:'Cancel'}}}}));
        duplicateHostApp.mount(host);await wait();
      };
      try {
      const duplicateEntry=(id,audio)=>({id,audio,title:'Duplicate title',artist:'Artist',album:'Album',duration:120,format:'FLAC',bitrate:900,sampleRate:44100,bitDepth:16,size:2048,mtimeMs:100});
      const duplicateFixture={id:'report-1',createdAt:'2026-10-31T01:00:00.000Z',scanned:3,hashed:2,extraFiles:1,extraBytes:2048,exactGroups:1,similarGroups:0,skipped:[{path:'missing.flac',reason:'unavailable'}],groups:[{id:'group-1',kind:'exact',durationSpread:0,hash:'a'.repeat(64),files:[duplicateEntry(101,'C:/music/original.flac'),duplicateEntry(102,'C:/music/copy.flac')]}]};
      window.__uiPlayer={queue:[{id:101},{id:102}],removeQueueItem:async index=>window.__uiPlayer.queue.splice(index,1)};
      window.api.library={
        onDuplicateTask:callback=>{duplicateListeners.add(callback);return()=>duplicateListeners.delete(callback)},
        getDuplicateTaskState:async()=>structuredClone(duplicateTask),
        getDuplicateTaskDetails:async()=>{duplicateDetailReads++;return structuredClone({task:duplicateTask,report:duplicateReport,retainedIds:duplicateRetained})},
        saveDuplicateSelection:async(id,ids)=>{duplicateRetained=[...ids];duplicateTask.revision++;publishDuplicate();return {success:true,data:true}},
        startDuplicateTask:async options=>{
          duplicateScanOptions.push(options);duplicateScans++;duplicateReport=null;duplicateRetained=null;
          duplicateTask={id:'task-'+duplicateScans,revision:1,status:'running',options,progress:null};
          publishDuplicate();duplicateProgressListener({phase:'hashing',current:2,total:2});
          const finish=()=>{duplicateReport=structuredClone(duplicateFixture);duplicateTask.status='completed';duplicateTask.reportId=duplicateReport.id;duplicateTask.groupCount=1;duplicateTask.revision++;publishDuplicate()};
          if(duplicateDeferred){duplicateDeferred=false;duplicateRelease=finish}else setTimeout(finish,0);
          return {success:true,data:structuredClone(duplicateTask)};
        },
        pauseDuplicateTask:async()=>{duplicateTask.status='paused';duplicateTask.revision++;publishDuplicate();return {success:true,data:true}},
        resumeDuplicateTask:async()=>{duplicateTask.status='running';duplicateTask.revision++;publishDuplicate();return {success:true,data:structuredClone(duplicateTask)}},
        clearDuplicateCache:async()=>{duplicateCacheClears++;return {success:true,data:true}},
        cancelDuplicateScan:async()=>{duplicateCancels++},
        exportDuplicateReport:async(id,language)=>{duplicateExportLanguage=language;duplicateExports++;return {success:id==='report-1',data:true}},
        cleanDuplicateFiles:async request=>{duplicateCleanups.push(request);duplicateTask=null;duplicateReport=null;duplicateRetained=null;publishDuplicate();return {success:true,data:{deletedIds:[...request.songIds],deletedFiles:request.deleteLocalFiles?request.songIds.length:0,failedFiles:[]}}}
      };
      await mountDuplicateHost();
      const duplicateRow=[...document.querySelectorAll('.setting-row')].find(row=>row.querySelector('h3')?.textContent==='duplicates.title');
      check(!!duplicateRow,'library maintenance exposes duplicate detection entry');
      duplicateRow.querySelector('button').click();await wait(350);
      const findDuplicateButton=key=>[...document.querySelectorAll('.ep-dialog-panel button')].find(button=>button.textContent.trim()===key);
      const chooseDuplicateCopy=async index=>{if(findDuplicateButton('duplicates.uncheckGroup'))findDuplicateButton('duplicates.uncheckGroup').click();await wait();[...document.querySelectorAll('table input[type=checkbox]')].filter((_,i)=>i!==index).forEach(input=>input.click());await wait();};
      check(duplicateScans===1 && duplicateCleanups.length===0,'duplicate detection opens a read-only report without cleanup');
      const reportHelp=document.querySelector('.duplicate-dialog .ep-dialog-header .ep-popover-trigger');
      check(!!reportHelp && !document.querySelector('.duplicate-dialog .ep-dialog-body').textContent.includes('duplicates.readOnly'),'report guidance is tucked into the title instead of occupying a body row');
      const helpRect=reportHelp.getBoundingClientRect(), helpIconRect=reportHelp.querySelector('svg').getBoundingClientRect(), reportTitleRect=document.querySelector('.duplicate-dialog .ep-dialog-title').getBoundingClientRect();
      check(helpRect.width===24 && helpRect.height===24 && Math.abs(helpIconRect.top+helpIconRect.height/2-(reportTitleRect.top+reportTitleRect.height/2))<1,'title help icon is centered with the heading in a full 24px target');
      for(const y of [helpRect.top+2,helpRect.top+helpRect.height/2,helpRect.bottom-2]){
        const hit=document.elementFromPoint(helpRect.left+helpRect.width/2,y);
        check(hit===reportHelp || reportHelp.contains(hit),'the title help target receives pointers at its top, middle and bottom');
      }

      reportHelp.dispatchEvent(new PointerEvent('pointerenter'));await wait();
      check(document.querySelector('.ep-popover')?.textContent.includes('duplicates.readOnly'),'hovering the title info icon displays cleanup guidance');
      check(['paddingTop','paddingRight','paddingBottom','paddingLeft'].every(side=>parseFloat(getComputedStyle(document.querySelector('.ep-popover'))[side])===8),'title guidance uses compact 8px padding');
      reportHelp.dispatchEvent(new PointerEvent('pointerleave'));await wait(400);
      check(!document.querySelector('.ep-popover'),'title guidance closes when the pointer leaves');
      reportHelp.focus();reportHelp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait();
      check(document.querySelector('.ep-popover')?.textContent.includes('duplicates.readOnly'),'title guidance can also be opened from the keyboard');
      reportHelp.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(300);
      check(!!document.querySelector('.duplicate-dialog') && !document.querySelector('.ep-popover'),'Escape closes title guidance without closing the report');

      check(!document.querySelector('.duplicate-file-name').textContent.includes('KiB') && document.querySelector('.duplicate-file-quality').textContent.includes('KiB'),'file sizes appear with audio quality rather than the filename');
      check(document.querySelectorAll('.duplicate-settings .ep-switch').length===2 && document.querySelectorAll('.duplicate-settings .ep-select').length===2 && document.querySelector('.duplicate-dialog .ep-dialog-footer .ep-button--danger'),'duplicate report reuses shared switches, selectors and button variants');
      check(document.body.textContent.includes('C:/music/original.flac') && document.body.textContent.includes('C:/music/copy.flac'),'comparison report displays complete file paths');
      check([...document.querySelectorAll('table input[type=checkbox]')].every(input=>!input.checked) && findDuplicateButton('duplicates.cleanSelected').disabled,'duplicate report defaults to no cleanup selections');
      findDuplicateButton('duplicates.checkGroup').click();await wait();
      check(!document.querySelectorAll('table input[type=checkbox]')[0].checked && document.querySelectorAll('table input[type=checkbox]')[0].disabled && document.querySelectorAll('table input[type=checkbox]')[1].checked && !!findDuplicateButton('duplicates.uncheckGroup'),'group check selects extra copies while protecting the first copy');
      findDuplicateButton('duplicates.uncheckGroup').click();await wait();
      check([...document.querySelectorAll('table input[type=checkbox]')].every(input=>!input.checked),'group uncheck clears every selected cleanup candidate');
      const detailReadsBeforeSelection=duplicateDetailReads;
      await chooseDuplicateCopy(0);
      let duplicateCheckboxes=[...document.querySelectorAll('table input[type=checkbox]')];
      check(!duplicateCheckboxes[0].checked && duplicateCheckboxes[0].disabled && duplicateCheckboxes[1].checked,'checked files are cleanup candidates and the remaining unchecked copy cannot be selected');
      check(duplicateDetailReads===detailReadsBeforeSelection,'saving retention choices does not reload the full comparison report');
      check(document.querySelectorAll('table tbody tr')[0].textContent.includes('duplicates.retained') && document.querySelectorAll('table tbody tr')[1].textContent.includes('duplicates.pendingCleanup'),'each file explicitly displays retained or pending cleanup state');
      findDuplicateButton('duplicates.keepAndClose').click();await wait(300);duplicateRow.querySelector('button').click();await wait(300);
      duplicateCheckboxes=[...document.querySelectorAll('table input[type=checkbox]')];
      check(duplicateScans===1 && !duplicateCheckboxes[0].checked && duplicateCheckboxes[1].checked,'closing and reopening a report preserves retention choices');
      findDuplicateButton('duplicates.keepAndClose').click();await wait(300);
      await mountDuplicateHost();eventBus.emit('openDuplicateReport');await wait(350);
      duplicateCheckboxes=[...document.querySelectorAll('table input[type=checkbox]')];
      check(duplicateScans===1 && !duplicateCheckboxes[0].checked && duplicateCheckboxes[1].checked,'recreating the global report host restores the saved report and retention choices');
      findDuplicateButton('duplicates.uncheckGroup').click();await wait();
      check(duplicateCheckboxes.every(input=>!input.checked),'clearing the group unchecks every cleanup candidate');
      findDuplicateButton('duplicates.export').click();await wait();
      check(duplicateExports===1 && duplicateCleanups.length===0 && duplicateExportLanguage==='en','export sends the active UI language without cleaning files');
      await chooseDuplicateCopy(0);findDuplicateButton('duplicates.cleanSelected').click();await wait();
      let cleanupConfirmation=document.querySelector('[role=group][aria-label="duplicates.confirmTitle"]');
      check(!!cleanupConfirmation && cleanupConfirmation.querySelector('[role=switch]').getAttribute('aria-checked')==='false' && duplicateCleanups.length===0,'cleanup requires confirmation and defaults to library-only removal');
      check(cleanupConfirmation.querySelector('li')?.textContent.includes('Duplicate title') && cleanupConfirmation.querySelector('li')?.textContent.includes('C:/music/copy.flac') && !cleanupConfirmation.querySelector('ul').textContent.includes('original.flac'),'cleanup confirmation lists only the selected songs and their paths');
      [...cleanupConfirmation.querySelectorAll('button')].find(button=>button.textContent.trim()==='Cancel').click();await wait();
      check(duplicateCleanups.length===0,'cancelling duplicate cleanup leaves all files untouched');
      findDuplicateButton('duplicates.cleanSelected').click();await wait();findDuplicateButton('duplicates.confirmClean').click();await wait();
      check(duplicateCleanups.length===1 && duplicateCleanups[0].deleteLocalFiles===false && duplicateCleanups[0].songIds.join(',')==='102','default confirmed cleanup removes only the selected duplicate library entry');
      check(window.__uiPlayer.queue.length===1 && window.__uiPlayer.queue[0].id===101,'duplicate cleanup removes selected entries from the play queue');
      findDuplicateButton('duplicates.rescan').click();await wait();await chooseDuplicateCopy(0);findDuplicateButton('duplicates.cleanSelected').click();await wait();
      cleanupConfirmation=document.querySelector('[role=group][aria-label="duplicates.confirmTitle"]');
      cleanupConfirmation.querySelector('[role=switch]').click();await wait();findDuplicateButton('duplicates.confirmClean').click();await wait();
      check(duplicateCleanups.length===2 && duplicateCleanups[1].deleteLocalFiles===true,'deleting local duplicate files requires explicit opt-in and confirmation');
      duplicateFixture.exactGroups=0;duplicateFixture.similarGroups=1;
      Object.assign(duplicateFixture.groups[0],{kind:'similar',hash:undefined,durationSpread:2});
      findDuplicateButton('duplicates.rescan').click();await wait();
      check(document.body.textContent.includes('duplicates.similar') && document.body.textContent.includes('duplicates.similarReason'),'nonidentical song candidates show their similarity basis and manual-review label');
      await chooseDuplicateCopy(1);
      duplicateCheckboxes=[...document.querySelectorAll('table input[type=checkbox]')];
      check(duplicateCheckboxes[0].checked && !duplicateCheckboxes[1].checked && duplicateCheckboxes[1].disabled,'checking the first file cleans only that file and leaves the second unchecked and protected');
      findDuplicateButton('duplicates.cleanSelected').click();await wait();
      cleanupConfirmation=document.querySelector('[role=group][aria-label="duplicates.confirmTitle"]');
      check(cleanupConfirmation.textContent.includes('duplicates.similarConfirm'),'cleanup confirmation identifies selections containing merely similar songs');
      findDuplicateButton('duplicates.confirmClean').click();await wait();
      check(duplicateCleanups.length===3 && duplicateCleanups[2].songIds.join(',')==='101' && duplicateCleanups[2].deleteLocalFiles===false,'retained IDs are never submitted for cleanup even when keeping an alternative similar version');
      document.querySelector('.duplicate-settings').open=true;
      const duplicateOption=key=>document.querySelector('.ep-dialog-panel [role=switch][aria-label="'+key+'"]');
      check(duplicateOption('duplicates.deepScan').getAttribute('aria-checked')==='false' && duplicateScanOptions[0].deep===false,'audio fingerprinting is optional and quick scans remain the default');
      const sampleLengthSelect=document.querySelector('button[aria-label="duplicates.sampleLength"]');
      check(sampleLengthSelect?.textContent.includes('duplicates.sample60') && sampleLengthSelect.disabled,'fingerprint sample length defaults to 60 seconds and is inactive for quick scans');
      const concurrencySelect=document.querySelector('button[aria-label="duplicates.concurrency"]');
      check(concurrencySelect?.textContent.includes('duplicates.concurrency2') && concurrencySelect.disabled,'fingerprint concurrency defaults to two jobs and is inactive for quick scans');
      duplicateOption('duplicates.deepScan').click();duplicateOption('duplicates.forceScan').click();await wait();
      Object.assign(duplicateFixture,{mode:'deep',sampleSeconds:60,matchingStats:{candidatePairs:511,comparisons:500,reusedPairs:11},timings:{checkingMs:10,hashingMs:20,fingerprintMs:30,matchingMs:10,totalMs:70},fingerprinted:2,audioGroups:1,similarGroups:0,cacheHits:{sha256:2,fingerprint:2,matches:1,report:0}});
      Object.assign(duplicateFixture.groups[0],{kind:'audio',audioMatch:{score:0.96,coverage:0.95,offsetSeconds:0.3}});
      findDuplicateButton('duplicates.rescan').click();await wait();
      check(duplicateScanOptions.at(-1).deep===true && duplicateScanOptions.at(-1).force===true,'deep mode and force-recompute options reach the scanning API');
      check(duplicateScanOptions.at(-1).concurrency===2 && !concurrencySelect.disabled,'default two-job concurrency reaches the deep scanning API');
      duplicateFixture.fingerprintWarnings=[{path:'C:/music/recovered.flac',reason:'decodeWarning',exitCode:3,stderr:'invalid frame'}];duplicateFixture.fingerprintSkipped=['C:/music/broken.flac'];duplicateFixture.fingerprintFailures=[{path:'C:/music/broken.flac',reason:'decodeFailed',exitCode:1,stderr:'Decoder failed: invalid audio'}];
      findDuplicateButton('duplicates.rescan').click();await wait();
      document.querySelector('.duplicate-report-details').click();await wait();
      check(document.body.textContent.includes('Usable fingerprint retained') && document.body.textContent.includes('C:/music/recovered.flac'),'usable extraction warnings remain visible separately from failed fingerprints');
      check(document.body.textContent.includes('Audio decoding or extraction failed') && document.body.textContent.includes('Decoder failed: invalid audio'),'report details show the fingerprint failure category and raw diagnostic');
      check(duplicateScanOptions.at(-1).sampleSeconds===60 && document.body.textContent.includes('duplicates.scanTimings'),'60-second scans send their extraction limit and show per-stage timings');
      check(document.body.textContent.includes('duplicates.audioEvidence') && document.body.textContent.includes('duplicates.cacheSummary'),'deep reports expose audio-match evidence and cache reuse');
      findDuplicateButton('duplicates.clearCache').click();await wait();
      check(duplicateCacheClears===1 && duplicateCleanups.length===3,'clearing analysis cache does not clean library entries or files');
      document.querySelector('.duplicate-settings').open=true;
      sampleLengthSelect.click();await wait();[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.includes('duplicates.sample120')).click();await wait();
      findDuplicateButton('duplicates.rescan').click();await wait();
      check(duplicateScanOptions.at(-1).sampleSeconds===120,'the optional 120-second analysis limit reaches the scanning API');
      for (const count of [1,4]) {
        document.querySelector('.duplicate-settings').open=true;
        concurrencySelect.click();await wait();[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.includes('duplicates.concurrency'+count)).click();await wait();
        findDuplicateButton('duplicates.rescan').click();await wait();
        check(duplicateScanOptions.at(-1).concurrency===count,'selected '+count+'-job fingerprint concurrency reaches the scanning API');
      }
      duplicateDeferred=true;findDuplicateButton('duplicates.rescan').click();await wait();
      duplicateProgressListener({phase:'checking',current:12,total:100,activeChecks:8,currentPath:'C:/music/slow-path.flac'});await wait();
      check(document.body.textContent.includes('duplicates.checkingActive') && document.body.textContent.includes('C:/music/slow-path.flac'),'file checks display bounded parallel activity and the outstanding path');
      duplicateProgressListener({phase:'checking',current:12,total:100,activeChecks:0,waitingForPlayback:true});await wait();
      check(document.body.textContent.includes('duplicates.checkingPaused'),'file checks distinguish playback-mode suspension from slow I/O');
      duplicateProgressListener({phase:'indexing',current:15,total:100});await wait();
      check(document.body.textContent.includes('duplicates.indexing'),'deep scans display candidate-index construction progress');
      duplicateProgressListener({phase:'matching',current:20,total:100,comparedPairs:128});await wait();
      check(document.body.textContent.includes('duplicates.comparedPairs'),'deep scans display candidate-pair processing while comparisons run');
      findDuplicateButton('duplicates.runInBackground').click();await wait(300);
      check(duplicateTask.status==='running' && duplicateCancels===0 && !!document.querySelector('[aria-label="duplicates.openTask"]'),'closing the report keeps scanning and exposes a global task entry');
      await mountDuplicateHost();eventBus.emit('openDuplicateReport');await wait(350);
      check(duplicateScans>1 && document.body.textContent.includes('duplicates.comparedPairs'),'reopening from a recreated host recovers the in-flight progress');
      const scansBeforeResume=duplicateScans;
      findDuplicateButton('duplicates.pause').click();await wait();
      check(duplicateTask.status==='paused' && !!findDuplicateButton('duplicates.resume'),'a running scan can be paused without discarding the task');
      findDuplicateButton('duplicates.resume').click();await wait();
      check(duplicateTask.status==='running' && duplicateScans===scansBeforeResume,'resume continues the same scan task');
      duplicateRelease();await wait();
      document.querySelector('.duplicate-report-details').click();await wait();
      check(document.body.textContent.includes('duplicates.matchingWork'),'reports distinguish candidate count, new comparisons and reused results');
      findDuplicateButton('duplicates.keepAndClose').click();await wait(300);
      await mountDuplicateHost();eventBus.emit('openDuplicateReport');await wait(350);
      check(duplicateOption('duplicates.deepScan').getAttribute('aria-checked')==='true' && document.querySelector('button[aria-label="duplicates.sampleLength"]').textContent.includes('duplicates.sample120') && document.querySelector('button[aria-label="duplicates.concurrency"]').textContent.includes('duplicates.concurrency4'),'reopening a completed task restores its saved deep-scan options');
      findDuplicateButton('duplicates.keepAndClose').click();await wait(300);
      check(!document.querySelector('.duplicate-task-entry'),'closing an already viewed completed report does not restore its notice');
      await mountDuplicateHost();
      check(!document.querySelector('.duplicate-task-entry') && !document.querySelector('.duplicate-dialog'),'startup restores an old completed report silently');
      const emitNewCompletion=async()=>{duplicateTask.status='running';duplicateTask.revision++;publishDuplicate();await wait();duplicateTask.status='completed';duplicateTask.revision++;publishDuplicate();await wait();};
      await emitNewCompletion();
      check(!!document.querySelector('.duplicate-task-entry'),'a scan completing in this session still shows a notification');
      document.querySelector('.duplicate-task-entry [title="duplicates.openTask"]').click();await wait(350);
      check(!!document.querySelector('.duplicate-dialog') && !document.querySelector('.duplicate-task-entry'),'the view arrow opens the completed report and acknowledges its notice');
      findDuplicateButton('duplicates.keepAndClose').click();await wait(300);
      duplicateTask.revision++;publishDuplicate();await wait();
      check(!document.querySelector('.duplicate-task-entry'),'an acknowledged completion notice stays closed after leaving the report and receiving task updates');
      await mountDuplicateHost();
      check(!document.querySelector('.duplicate-task-entry'),'restarting after viewing completion does not restore the notice');
      await emitNewCompletion();
      check(!!document.querySelector('.duplicate-task-entry'),'completed scans expose a reopenable report notice');
      const completedReportId=duplicateReport.id;
      document.querySelector('[aria-label="duplicates.dismissTask"]').click();await wait();
      check(!document.querySelector('.duplicate-task-entry') && duplicateReport.id===completedReportId && duplicateTask.status==='completed' && duplicateCancels===0 && !document.querySelector('.duplicate-dialog'),'dismissing a completed notice hides only the notice and never opens, cancels or removes its report');
      duplicateTask.revision++;publishDuplicate();await wait();
      check(!document.querySelector('.duplicate-task-entry'),'updates to the same completed task do not resurrect a dismissed notice');
      eventBus.emit('openDuplicateReport');await wait(350);
      check(!!document.querySelector('.duplicate-dialog') && duplicateReport.id===completedReportId,'settings can reopen the saved report after its notice is dismissed');
      check(!findDuplicateButton('duplicates.keepThis'),'file rows use retention checkboxes without a redundant keep-this button');
      const detailsToggle=document.querySelector('.duplicate-report-details'), detailsRect=detailsToggle.getBoundingClientRect(), detailsToolbarTop=detailsToggle.closest('.duplicate-report-meta').getBoundingClientRect().top;
      detailsToggle.click();await wait();
      const expandedRect=detailsToggle.getBoundingClientRect();
      check(Math.abs(expandedRect.right-detailsRect.right)<1 && Math.abs((expandedRect.top-detailsToggle.closest('.duplicate-report-meta').getBoundingClientRect().top)-(detailsRect.top-detailsToolbarTop))<1,'expanding cache details keeps its trigger on the same row and position');
      check(detailsToggle.getAttribute('aria-expanded')==='true' && !!document.getElementById(detailsToggle.getAttribute('aria-controls')),'cache details expose an accessible full-width panel below the toolbar');
      detailsToggle.click();await wait();
      const paginationGroups=structuredClone(duplicateFixture.groups);
      duplicateFixture.groups=Array.from({length:25},(_,index)=>({...structuredClone(paginationGroups[0]),id:'paged-'+index,files:paginationGroups[0].files.map(file=>({...file,id:file.id+index*1000}))}));
      findDuplicateButton('duplicates.rescan').click();await wait();
      const reportBody=document.querySelector('.duplicate-dialog .ep-dialog-body');reportBody.scrollTop=reportBody.scrollHeight;
      findDuplicateButton('duplicates.next').click();await wait();
      check(reportBody.scrollTop===0 && document.querySelectorAll('.duplicate-group').length===5,'next page resets the report body to the top');
      reportBody.scrollTop=reportBody.scrollHeight;findDuplicateButton('duplicates.previous').click();await wait();
      check(reportBody.scrollTop===0 && document.querySelectorAll('.duplicate-group').length===20,'previous page also resets the report body to the top');
      document.querySelectorAll('table input[type=checkbox]')[1].click();await wait();
      findDuplicateButton('duplicates.next').click();await wait();
      document.querySelectorAll('table input[type=checkbox]')[1].click();await wait();
      findDuplicateButton('duplicates.cleanSelected').click();await wait();
      findDuplicateButton('duplicates.resetSelection').click();await wait();
      check(duplicateRetained.length===50 && [...document.querySelectorAll('table input[type=checkbox]')].every(input=>!input.checked) && findDuplicateButton('duplicates.cleanSelected').disabled && !document.querySelector('[aria-label="duplicates.confirmTitle"]'),'reset clears cleanup choices across all pages, persists all retained files and cancels confirmation');
      findDuplicateButton('duplicates.previous').click();await wait();
      check([...document.querySelectorAll('table input[type=checkbox]')].every(input=>!input.checked),'reset also leaves every file unchecked on the previous page');
      duplicateFixture.groups=paginationGroups;
      window.__duplicateUiPreview=async(kind='report')=>{
        duplicateVisual=true;
        const files=duplicateFixture.groups[0].files;
        files[0].title='夜空中最亮的星';files[0].artist='逃跑计划';files[0].album='世界';files[0].audio='D:/Music/逃跑计划/世界/夜空中最亮的星.flac';
        files[1].title='夜空中最亮的星';files[1].artist='逃跑计划';files[1].album='世界';files[1].format='MP3';files[1].bitrate=320;files[1].audio='D:/Music/导入备份/夜空中最亮的星.mp3';
        duplicateFixture.scanned=1248;duplicateFixture.extraFiles=2;duplicateFixture.extraBytes=48926720;
        duplicateFixture.groups=[duplicateFixture.groups[0],{id:'group-2',kind:'exact',hash:'a'.repeat(64),durationSpread:0,files:files.map((file,index)=>({...file,id:201+index,title:'平凡之路',artist:'朴树',album:'猎户星座',audio:'D:/Music/'+(index?'备份/':'')+'朴树/平凡之路.flac'}))}];
        duplicateFixture.exactGroups=1;
        duplicateTask={id:'preview',revision:1,status:'completed',reportId:duplicateFixture.id,groupCount:2,options:{deep:true,sampleSeconds:60,concurrency:2},progress:{phase:'matching',current:828,total:1248,comparedPairs:15360}};
        duplicateReport=structuredClone(duplicateFixture);duplicateRetained=null;
        if(kind==='running'||kind==='background'){duplicateTask.status='running';duplicateReport=null;}
        await mountDuplicateHost();if(kind!=='completedNotice')eventBus.emit('openDuplicateReport');else {duplicateTask.status='running';publishDuplicate();duplicateTask.status='completed';publishDuplicate();}await wait(350);
        if(kind==='settings')document.querySelector('.duplicate-settings').open=true;
        if(kind==='details')document.querySelector('.duplicate-report-details').click();
        if(kind==='help')document.querySelector('.duplicate-report-help .ep-popover-trigger').dispatchEvent(new PointerEvent('pointerenter'));
        if(kind==='cleanup'){
          document.querySelectorAll('table input[type=checkbox]')[1].click();await wait();
          [...document.querySelectorAll('.ep-dialog-footer button')].find(button=>button.textContent.includes('清理')).click();await wait();
        }
        if(kind==='background'){[...document.querySelectorAll('.ep-dialog-footer button')].find(button=>button.textContent.trim()===Checks.zh.duplicates.runInBackground).click();await wait(300);}
        await wait();
      };
      duplicateHostApp.unmount();
      } catch (error) { throw new Error('Duplicate UI check after '+results.at(-1)+': '+error.message); }
      activeApp.unmount(); messages.clear(); return results;
    })()`)
    assert.ok(results.length >= 20)
    console.log(JSON.stringify({ passed: results.length, checks: results }, null, 2))
    await window.webContents.executeJavaScript('window.__duplicateUiPreview("completedNotice")')
    const noticeBefore = await window.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('.duplicate-task-entry')).backgroundColor`
    )
    // Hidden windows cannot reliably receive OS pointer input. Apply Chromium's
    // actual CSS hover state, including shared ghost-button styles.
    window.webContents.debugger.attach('1.3')
    try {
      await window.webContents.debugger.sendCommand('DOM.enable')
      await window.webContents.debugger.sendCommand('CSS.enable')
      const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument')
      for (const selector of ['.duplicate-task-entry', '.duplicate-task-open']) {
        const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', {
          nodeId: root.nodeId,
          selector
        })
        await window.webContents.debugger.sendCommand('CSS.forcePseudoState', {
          nodeId,
          forcedPseudoClasses: ['hover']
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
      const noticeHover = await window.webContents.executeJavaScript(`(()=>{
        const entry=document.querySelector('.duplicate-task-entry');
        return {background:getComputedStyle(entry).backgroundColor,buttonBackground:getComputedStyle(entry.querySelector('.duplicate-task-open')).backgroundColor};
      })()`)
      assert.equal(noticeHover.background, noticeBefore, 'hover preserves the notice surface')
      assert.notEqual(
        noticeHover.background,
        'rgba(0, 0, 0, 0)',
        'completed report notice has a visible background'
      )
      assert.equal(
        noticeHover.buttonBackground,
        'rgba(0, 0, 0, 0)',
        'hover leaves the permanent card surface visible'
      )
      console.log(
        'Completed notice hover check passed: stable background with Chromium hover state.'
      )
    } finally {
      window.webContents.debugger.detach()
    }
    if (process.argv.includes('--duplicate-preview')) {
      const symbols = [
        'common/info',
        'common/check',
        'common/time',
        'common/warning',
        'arrow/arrow-down',
        'arrow/arrow-right-light'
      ]
        .map((name) => {
          const svg = fs.readFileSync(
            path.join('src/renderer/src/assets/svg', name + '.svg'),
            'utf8'
          )
          const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] || '0 0 24 24'
          const content = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
          return (
            '<symbol id="icon-' +
            name.replace('/', '-') +
            '" viewBox="' +
            viewBox +
            '" fill="none">' +
            content +
            '</symbol>'
          )
        })
        .join('')
      for (const [name, width, height, dark, kind] of [
        ['light', 1100, 840, false, 'report'],
        ['dark', 1100, 840, true, 'report'],
        ['details', 1100, 840, false, 'details'],
        ['help', 1100, 840, false, 'help'],
        ['narrow', 390, 844, false, 'report'],
        ['settings', 390, 844, true, 'settings'],
        ['running', 1100, 840, true, 'running'],
        ['cleanup', 1100, 840, false, 'cleanup'],
        ['background', 1100, 840, false, 'background']
      ]) {
        window.setContentSize(width, height)
        await window.webContents.executeJavaScript(
          'document.documentElement.classList.toggle("dark",' +
            dark +
            ');window.__duplicateUiPreview(' +
            JSON.stringify(kind) +
            ')'
        )
        await window.webContents.executeJavaScript(
          'document.body.insertAdjacentHTML("afterbegin",' +
            JSON.stringify('<svg style="display:none">' + symbols + '</svg>') +
            ')'
        )
        const geometry = await window.webContents.executeJavaScript(`(()=>{
          const panel=document.querySelector('.duplicate-dialog'), footer=panel?.querySelector('.ep-dialog-footer');
          if(!panel)return {background:true};
          const tables=[...panel.querySelectorAll('.duplicate-table')];if(innerWidth>=640 && tables.length>1){const widths=tables.map(table=>[...table.querySelectorAll('th')].map(cell=>cell.getBoundingClientRect().width));if(widths[0].some((width,index)=>Math.abs(width-widths[1][index])>1))throw Error('report column widths differ across groups');}
          const rect=panel.getBoundingClientRect(), foot=footer.getBoundingClientRect(), body=panel.querySelector('.ep-dialog-body');
          return {width:rect.width,height:rect.height,footerBottom:foot.bottom,overflow:body.scrollWidth-body.clientWidth,viewportHeight:innerHeight,outerScroll:panel.parentElement.scrollHeight-panel.parentElement.clientHeight};
        })()`)
        assert.ok(
          geometry.background ||
            (geometry.height <= height &&
              geometry.footerBottom <= height &&
              geometry.overflow <= 1 &&
              geometry.outerScroll <= 1),
          name + ' report fits viewport: ' + JSON.stringify(geometry)
        )
        const target = path.resolve('build/duplicate-ui-' + name + '.png')
        fs.writeFileSync(target, (await window.webContents.capturePage()).toPNG())
        console.log('Duplicate preview: ' + target + ' ' + JSON.stringify(geometry))
      }
    }
    await window.webContents.executeJavaScript(`(async()=>{
      const {Vue,UI,createI18n}=Checks;const {h,createApp}=Vue;
      document.body.innerHTML='<div id="showcase"></div>';
      createApp({render:()=>h('main',{style:'padding:32px;display:grid;gap:20px;max-width:880px;margin:auto'},[
        h('h1',{style:'font-size:24px;font-weight:650'},'UI component standards'),
        h('p',{style:'color:var(--color-text-l)'},'Shared sizing, state feedback, surfaces and keyboard focus'),
        h('div',{style:'display:flex;gap:12px;align-items:center'},['xs','sm','md','lg'].map(size=>h(UI.BaseButton,{size},()=>size))),
        h('div',{style:'display:flex;gap:12px;align-items:center'},[h(UI.BaseButton,{variant:'secondary'},()=> 'Secondary'),h(UI.BaseButton,{variant:'ghost'},()=> 'Ghost'),h(UI.BaseButton,{variant:'danger'},()=> 'Danger'),h(UI.BaseButton,{loading:true},()=> 'Saving'),h(UI.BaseButton,{disabled:true},()=> 'Disabled')]),
        h('div',{style:'display:grid;grid-template-columns:1fr 1fr;gap:16px'},[h(UI.BaseInput,{modelValue:'Editable input'}),h(UI.BaseInput,{modelValue:'Readonly input',readonly:true}),h(UI.BaseInput,{modelValue:'Invalid input',invalid:true}),h(UI.BaseInput,{modelValue:'Disabled input',disabled:true})]),
        h('div',{style:'display:flex;gap:24px;align-items:center'},[h(UI.BaseSwitch,{modelValue:true,activeText:'Enabled'}),h(UI.BaseSwitch,{modelValue:false,inactiveText:'Off'}),h(UI.BaseSelect,{modelValue:'one',options:[{label:'Selected option',value:'one'}]}),h(UI.BaseColorPicker,{modelValue:'#22c55e'})]),
        h(UI.BaseSlider,{modelValue:65}),h(UI.BaseSkeleton,{type:'row',size:40})
      ])}).use(createI18n({legacy:false,locale:'en',messages:{en:{ui:{clear:'Clear',color:'Color'}}}})).mount('#showcase');
      await Vue.nextTick();await new Promise(resolve=>setTimeout(resolve,200));
    })()`)
    const preview = path.resolve('build/ui-component-showcase.png')
    fs.mkdirSync(path.dirname(preview), { recursive: true })
    fs.writeFileSync(preview, (await window.webContents.capturePage()).toPNG())
    console.log('Preview: ' + preview)
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
