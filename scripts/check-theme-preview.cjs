/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Electron UI regression test. */
const { app, BrowserWindow } = require('electron')
const { readFileSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { parse, compileScript, compileStyle } = require('vue/compiler-sfc')

app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'ep-theme-preview-')))
app.disableHardwareAcceleration()
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, backgroundThrottling: false }
  })
  try {
    const { descriptor } = parse(
      readFileSync('src/renderer/src/components/settings/ThemePreviewDialog.vue', 'utf8')
    )
    const component = compile(
      compileScript(descriptor, { id: 'theme-safety', inlineTemplate: true }).content
    )
    const css = compileStyle({
      source: descriptor.styles[0].content,
      id: 'data-v-theme-safety',
      scoped: true
    }).code
    const timer = compile(readFileSync('src/renderer/src/services/themePreview.ts', 'utf8'))
    const settingsDescriptor = parse(
      readFileSync('src/renderer/src/components/settings/ThemeSettings.vue', 'utf8')
    ).descriptor
    const settingsComponent = compile(
      compileScript(settingsDescriptor, { id: 'settings-theme-test', inlineTemplate: true }).content
    )
    await window.loadURL(
      'data:text/html,<html><head></head><body><div id="app"></div></body></html>'
    )
    await window.webContents.executeJavaScript(
      readFileSync('node_modules/vue/dist/vue.global.prod.js', 'utf8')
    )
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const check=(ok,label)=>{if(!ok)throw new Error(label)};
      const timerModule={};(function(exports){${timer}})(timerModule);
      let cancelled=0,kept=0;
      const ui=Vue.reactive({customThemePreviewActive:false,customThemePreviewSeconds:0,effectiveCustomThemeName:'Test theme'});
      const timer=timerModule.createThemePreviewTimer((seconds)=>ui.customThemePreviewSeconds=seconds,()=>ui.cancelCustomThemePreview());
      ui.cancelCustomThemePreview=()=>{timer.stop();if(ui.customThemePreviewActive)cancelled++;ui.customThemePreviewActive=false};
      ui.confirmCustomThemePreview=()=>{if(!timer.confirm())return;kept++;ui.customThemePreviewActive=false};
      const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);
      const themeStyle=document.createElement('style');themeStyle.textContent=':root{--color-text:transparent!important;--color-bg:transparent!important}body,button{font-family:serif;color:transparent}.ep-dialog-panel,.ep-button{display:none!important}';document.head.append(themeStyle);
      const module={};(function(exports,require){${component}})(module,(id)=>id==='vue'?Vue:id==='vue-i18n'?{useI18n:()=>({t:(key,args)=>key+JSON.stringify(args??{})})}:{useUIStore:()=>ui});
      module.default.__scopeId='data-v-theme-safety';
      const app=Vue.createApp(module.default);app.mount('#app');
      const start=async()=>{ui.customThemePreviewActive=true;timer.start();await Vue.nextTick()};
      await start();
      const dialog=document.querySelector('dialog');
      check(dialog.open&&dialog.matches(':modal'),'native modal top layer');
      check(ui.customThemePreviewSeconds===10,'10-second countdown starts');
      check(getComputedStyle(dialog).backgroundColor==='rgb(16, 24, 39)','fixed dialog background');
      const buttons=dialog.querySelectorAll('button');
      check(getComputedStyle(buttons[0]).display!=='none'&&getComputedStyle(buttons[0]).color==='rgb(241, 245, 249)','recovery control protected from theme');
      await new Promise((resolve)=>setTimeout(resolve,10200));await Vue.nextTick();
      check(!dialog.open&&!ui.customThemePreviewActive&&cancelled===1,'real 10-second automatic rollback closes dialog');
      await start();buttons[1].click();await Vue.nextTick();
      check(kept===1&&!dialog.open,'keep confirms and closes');
      await start();dialog.dispatchEvent(new Event('cancel',{cancelable:true}));await Vue.nextTick();
      check(!dialog.open&&cancelled===2,'Escape cancellation restores theme');
      await start();buttons[0].click();await Vue.nextTick();
      check(!dialog.open&&cancelled===3,'restore button cancels');
      await start();app.unmount();
      check(!ui.customThemePreviewActive&&cancelled===4,'root unmount cancels preview');
      Object.assign(ui,{useDarkMode:true,useCustomBg:false,systemBackground:'none',followSystemTheme:false,useMica:false,micaAvailable:false,customThemeColor:'#abc'});
      ui.selectThemeBackground=(choice)=>{
        ui.cancelCustomThemePreview();
        ui.useDarkMode=choice!=='light';ui.useCustomBg=choice==='custom';ui.systemBackground=choice==='rainy'?'rainy':'none';
        return true;
      };
      const settingsModule={};(function(exports,require){${settingsComponent}})(settingsModule,(id)=>{
        if(id==='vue')return Vue;
        if(id==='vue-i18n')return {useI18n:()=>({t:(key)=>key})};
        if(id.includes('uiStore'))return {useUIStore:()=>ui};
        if(id.includes('systemBackgroundRegistry'))return {systemBackgroundThemes:[{id:'none'},{id:'rainy',labelKey:'Rainy'}]};
        if(id.includes('consts/color'))return {presetColors:[]};
        return {__esModule:true,default:{render:()=>null}};
      });
      const page=Vue.createApp({render:()=>Vue.h('div',[Vue.h(module.default),Vue.h(settingsModule.default)])});page.mount('#app');
      document.querySelector('.theme-option.light-preview').click();await Vue.nextTick();
      check(!document.querySelector('dialog').open&&!ui.useDarkMode,'settings light theme card switches without confirmation');
      document.querySelector('.system-background-preview--rainy').click();await Vue.nextTick();
      check(!document.querySelector('dialog').open&&ui.systemBackground==='rainy','settings dynamic background switches without confirmation');
      page.unmount();
      return 'Import confirmation dialog and real 10-second timeout passed; settings theme cards switch without confirmation';
    })()`)
    console.log(result)
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    window.destroy()
    app.exit(1)
  }
})
