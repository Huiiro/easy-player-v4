/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-remote-ui-'))
app.setPath('userData', path.join(temporary, 'user'))
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  let window
  const calls = []
  let sources = [
    {
      id: 1,
      name: 'Existing',
      type: 'webdav',
      baseUrl: 'https://nas/music/',
      auth: { type: 'basic', username: 'user', password: 'password' },
      status: null,
      sourceOrder: 0,
      importedCount: 0,
      songCount: 0,
      lastConnect: null
    }
  ]
  try {
    ipcMain.handle('database:command', (_event, request) => {
      calls.push(request)
      if (request.action === 'listSources') return { success: true, data: sources }
      if (request.params?.name === 'Duplicate')
        return { success: false, error: 'UNIQUE constraint failed: music_source.name' }
      if (request.params?.name === 'ID-conflict')
        return { success: false, error: 'UNIQUE constraint failed: music_source.id' }
      if (request.params?.name === 'Reject-save') throw new Error('Simulated save rejection')
      if (request.action === 'createSource')
        sources.push({ ...sources[0], ...request.params, id: 2 })
      if (request.action === 'updateSource')
        sources = sources.map((source) =>
          source.id === request.params.id ? request.params : source
        )
      return { success: true }
    })
    ipcMain.handle('remote-source:test', (_event, config) => {
      calls.push({ action: 'test', params: config })
      if (config.baseUrl.includes('offline.invalid'))
        return { success: false, error: 'ECONNREFUSED fixture' }
      if (config.auth.password === 'reject-test') throw new Error('Simulated test rejection')
      return { success: true, data: { version: 'fixture' } }
    })
    await esbuild.build({
      entryPoints: ['src/preload/index.ts'],
      outfile: path.join(temporary, 'preload.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron']
    })
    const bundle = await esbuild.build({
      stdin: {
        contents: `import * as Vue from 'vue'; import { createI18n } from 'vue-i18n'; import Page from './src/renderer/src/views/remote/Index.vue'; import BaseSelect from './src/renderer/src/components/ui/BaseSelect.vue'; import { useMessage } from './src/renderer/src/components/ui/useMessage'; import en from './src/renderer/src/i18n/locales/en'; export { Vue, createI18n, Page, BaseSelect, useMessage, en };`,
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'Fixture',
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
          name: 'sfc',
          setup(builder) {
            builder.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
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
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 900,
      webPreferences: {
        preload: path.join(temporary, 'preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        offscreen: true,
        backgroundThrottling: false
      }
    })
    fs.writeFileSync(
      path.join(temporary, 'fixture.html'),
      '<html><body><div id="app"></div></body></html>'
    )
    await window.loadFile(path.join(temporary, 'fixture.html'))
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const results = await window.webContents.executeJavaScript(`(async () => {
      const { Vue, createI18n, Page, BaseSelect, en, useMessage } = Fixture;
      const { createApp, h, reactive, nextTick } = Vue;
      const results = [], errors = [];
      window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
      const wait = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 100)); };
      const check = (value, message) => { if (!value) throw Error(message); results.push(message); };
      const notices = useMessage();
      const i18n = () => createI18n({ legacy:false, locale:'en', messages:{en} });
      let instance = createApp(Page).use(i18n()); instance.mount('#app'); await wait();
      const button = (text, root = document) => [...root.querySelectorAll('button')].find(button => button.textContent.trim() === text);
      const dialog = () => document.querySelector('[role=dialog]');
      const fill = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', {bubbles:true})); };
      button(en.remote.testConnection, document.querySelector('article')).click(); await wait();
      check(notices.messages.value.some(message => message.type === 'success'), 'Saved-source test crosses real preload/IPC with nested auth');
      notices.clear();
      button(en.remote.edit, document.querySelector('article')).click(); await wait();
      check(!!dialog(), 'Edit opens the existing connection');
      const inputs = dialog().querySelectorAll('input');
      check(inputs[2].value === 'user' && inputs[3].value === 'password', 'Edit restores authentication fields');
      fill(inputs[3], 'reject-test');
      button(en.remote.testConnection, dialog()).click(); await wait();
      check(notices.messages.value.some(message => message.type === 'error') && !button(en.remote.testConnection, dialog()).disabled, 'Rejected connection test reports an error and restores the button');
      notices.clear(); fill(inputs[3], 'password');
      button(en.remote.testConnection, dialog()).click(); await wait();
      check(notices.messages.value.some(message => message.type === 'success'), 'Dialog test crosses real preload/IPC');
      notices.clear();
      fill(inputs[0], 'Reject-save');
      button(en.common.save, dialog()).click(); await wait();
      check(!!dialog() && notices.messages.value.some(message => message.type === 'error'), 'Rejected save stays open and reports an error');
      notices.clear(); fill(inputs[0], 'Edited');
      button(en.common.save, dialog()).click(); await wait();
      check(!dialog() && document.querySelector('article h2').textContent === 'Edited', 'Save updates a connection without clone errors');
      button(en.remote.add).click(); await wait();
      button(en.common.save, dialog()).click(); await wait();
      check(!!dialog() && notices.messages.value.some(message => message.type === 'error'), 'Incomplete configuration stays open with validation feedback');
      const select = dialog().querySelector('.ep-select'); select.click(); await wait();
      const option = [...document.querySelectorAll('[role=option]')].find(option => option.textContent.includes('WebDAV'));
      option.click(); await wait();
      check(select.getAttribute('aria-expanded') === 'false' && !document.querySelector('[role=listbox]'), 'Protocol selection inside label stays closed');
      const createInputs = dialog().querySelectorAll('input');
      fill(createInputs[0], 'Created'); fill(createInputs[1], 'https://nas/new/'); fill(createInputs[2], 'new-user'); fill(createInputs[3], 'new-password');
      notices.clear(); fill(createInputs[1], 'not-an-address'); button(en.common.save, dialog()).click(); await wait();
      check(notices.messages.value.some(message=>message.message===en.remote.invalidAddress),'Malformed addresses show an address error instead of incomplete fields');
      notices.clear(); fill(createInputs[1], 'ftp://nas/music'); button(en.remote.testConnection, dialog()).click(); await wait();
      check(notices.messages.value.some(message=>message.message===en.remote.invalidAddress),'Protocol mismatch is reported as an invalid address');
      notices.clear(); fill(createInputs[1], 'https://nas/new/'); fill(createInputs[2], ''); button(en.common.save, dialog()).click(); await wait();
      check(notices.messages.value.some(message=>message.message.includes(en.remote.username)),'Missing credentials identify the required field');
      fill(createInputs[2], 'new-user'); fill(createInputs[0], 'Duplicate'); notices.clear(); button(en.common.save, dialog()).click(); await wait();
      check(!!dialog() && notices.messages.value.some(message=>message.message===en.remote.nameExists),'Duplicate source names show a dedicated message and retain form values');
      fill(createInputs[0], 'ID-conflict'); notices.clear(); button(en.common.save, dialog()).click(); await wait();
      check(notices.messages.value.some(message=>message.message===en.remote.idConflict),'Primary key conflicts are not reported as missing connection fields');
      fill(createInputs[0], 'Created'); fill(createInputs[1], 'https://offline.invalid/'); notices.clear(); button(en.remote.testConnection, dialog()).click(); await wait();
      check(notices.messages.value.some(message=>message.message==='ECONNREFUSED fixture'),'Connection failures retain their actual backend error');
      fill(createInputs[1], 'https://nas/new/');
      const overlay=document.querySelector('.ep-overlay');
      for(const type of ['mousedown','mouseup','click'])overlay.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0}));
      await wait();check(!!dialog() && createInputs[0].value==='Created','Clicking outside the source dialog does not close or reset it');
      notices.clear(); const save=button(en.common.save, dialog());save.click();save.click(); await wait();
      check(!dialog() && document.querySelectorAll('article').length === 2, 'Create serializes the nested authentication DTO');
      check(errors.length === 0, 'No unhandled dialog or IPC errors');
      instance.unmount();
      for (const teleport of [false, true]) {
        const state = reactive({ value:'a' });
        instance = createApp({render:()=>h('label', ['Field',h(BaseSelect,{modelValue:state.value,'onUpdate:modelValue':value=>state.value=value,teleport,options:[{label:'Alpha',value:'a'},{label:'Beta',value:'b'}]})])}).use(i18n());
        instance.mount('#app'); await wait();
        document.querySelector('.ep-select').click(); await wait();
        document.querySelectorAll('[role=option]')[1].querySelector('span:last-child').click(); await wait();
        check(state.value === 'b' && document.querySelector('.ep-select').getAttribute('aria-expanded') === 'false', 'Label-wrapped select picks once and stays closed (teleport='+teleport+')');
        instance.unmount();
      }
      notices.clear(); return results;
    })()`)
    assert(
      calls.some(
        (call) => call.action === 'createSource' && call.params.auth.password === 'new-password'
      )
    )
    assert(calls.some((call) => call.action === 'updateSource' && call.params.id === 1))
    console.log(results.join('\n'))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    window?.destroy()
    app.exit(1)
  }
})
