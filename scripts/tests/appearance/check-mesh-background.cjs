/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
fs.mkdirSync('build', { recursive: true })
const root = fs.mkdtempSync(path.resolve('build/mesh-background-'))
app.setPath('userData', path.join(root, 'user-data'))
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

async function checkBackground() {
  const { Vue, Background, MeshFlowRenderer, resolvePlayerBgType } = window.MeshCheck
  const wait = async (ms = 100) => {
    await Vue.nextTick()
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  const check = (ok, message) => {
    if (!ok) throw Error(message)
  }
  const originalResize = MeshFlowRenderer.prototype.resize
  MeshFlowRenderer.prototype.resize = function () {
    window.meshRenderer = this
    return originalResize.call(this)
  }
  const cover = document.createElement('canvas')
  cover.width = cover.height = 256
  const context = cover.getContext('2d')
  const gradient = context.createLinearGradient(0, 0, 256, 256)
  gradient.addColorStop(0, '#223684')
  gradient.addColorStop(0.4, '#cf4c89')
  gradient.addColorStop(0.65, '#f8b66f')
  gradient.addColorStop(1, '#2695a6')
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  context.fillStyle = '#292445'
  context.beginPath()
  context.arc(95, 85, 65, 0, Math.PI * 2)
  context.fill()
  const props = Vue.reactive({
    coverSrc: cover.toDataURL(),
    primary: '70 100 190',
    secondary: '198 85 140',
    tertiary: '66 164 155',
    active: true,
    reducedMotion: false,
    energy: 0.5
  })
  let unavailable = 0
  const instance = Vue.createApp({
    render: () => Vue.h(Background, { ...props, onUnavailable: () => unavailable++ })
  })
  instance.mount('#app')
  await wait(900)
  const renderer = window.meshRenderer
  check(renderer && !renderer.disposed && !unavailable, 'Shader initializes successfully')
  const canvas = document.querySelector('canvas')
  const gl = canvas.getContext('webgl')
  const pixels = () => {
    renderer.draw()
    const data = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
    check(gl.getError() === gl.NO_ERROR, 'All rendering passes are valid WebGL')
    return data
  }
  const first = pixels()
  let minimum = 255,
    maximum = 0
  for (let i = 0; i < first.length; i += 4) {
    minimum = Math.min(minimum, first[i], first[i + 1], first[i + 2])
    maximum = Math.max(maximum, first[i], first[i + 1], first[i + 2])
    check(first[i + 3] === 255, 'The mesh covers every viewport pixel')
  }
  check(maximum - minimum > 40 && maximum > 70, 'Artwork produces a varied, visible color field')
  await wait(450)
  const moving = pixels()
  check(
    moving.some((value, index) => value !== first[index]),
    'Flow actually animates'
  )
  props.active = false
  await wait()
  const paused = renderer.time
  await wait(200)
  check(
    renderer.time === paused && renderer.frame === 0,
    'Inactive background stops scheduling frames'
  )
  props.active = true
  props.reducedMotion = true
  await wait(200)
  check(renderer.time === paused && renderer.frame === 0, 'Reduced motion retains a static frame')
  props.coverSrc = null
  await wait()
  pixels()
  check(renderer.currentPixels, 'No-cover background draws the palette fallback')
  props.coverSrc = 'data:image/png;base64,broken'
  await wait()
  check(
    renderer.source === null && !unavailable,
    'A broken cover keeps a usable palette background'
  )
  props.coverSrc = cover.toDataURL()
  await wait()
  check(renderer.source === props.coverSrc, 'A later valid cover recovers after failure')
  props.reducedMotion = false
  await wait()
  check(renderer.time > paused && renderer.frame !== 0, 'Animation resumes')
  const previousTextures = renderer.textures.slice()
  window.meshProps = props
  window.meshPixels = pixels
  window.checkMeshResize = async () => {
    await wait(200)
    check(canvas.width * canvas.height <= 910000, 'Backing buffer respects its pixel budget')
    pixels()
  }
  window.checkMeshDisposal = async () => {
    const lost = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(lost)
    await wait()
    check(
      unavailable === 1 && renderer.disposed && renderer.frame === 0,
      'Context loss signals fallback and stops rendering'
    )
    instance.unmount()
    check(
      previousTextures.every((texture) => !gl.isTexture(texture)),
      'Unmount releases GPU textures'
    )
    check(resolvePlayerBgType('mesh') === 'mesh', 'New background is a persistent selectable type')
    check(
      resolvePlayerBgType('mesh', { meshAvailable: false }) === 'ambient',
      'GPU failure resolves to ambient without rewriting preferences'
    )
  }
  return 'Mesh background: artwork, animation, static mode, fallback, recovery and WebGL passes passed.'
}

app.whenReady().then(async () => {
  try {
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents:
          "export * as Vue from 'vue';export {default as Background} from './src/renderer/src/components/background/MeshFlowBackground.vue';export {MeshFlowRenderer} from './src/renderer/src/components/background/meshFlowRenderer';export {resolvePlayerBgType} from './src/renderer/src/consts';"
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'MeshCheck',
      alias: { vue: require.resolve('vue/dist/vue.esm-bundler.js') },
      define: {
        __APP_VERSION__: '"test"',
        __APP_BUILD__: '"0"',
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      plugins: [
        {
          name: 'vue',
          setup(build) {
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              return {
                contents: compileScript(descriptor, { id: 'mesh-check', inlineTemplate: true })
                  .content,
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    const win = new BrowserWindow({
      show: false,
      width: 960,
      height: 600,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    const html = path.join(root, 'check.html')
    fs.writeFileSync(
      html,
      '<html><style>html,body,#app{width:100%;height:100%;margin:0;background:#17202b}canvas{display:block;width:100%;height:100%}</style><body><div id="app"></div></body></html>'
    )
    await win.loadFile(html)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const result = await win.webContents.executeJavaScript(
      '(' + checkBackground.toString() + ')().catch(error=>({error:error.stack}))'
    )
    if (result.error) throw Error(result.error)
    console.log(result)
    await new Promise((resolve) => setTimeout(resolve, 650))
    await win.webContents.executeJavaScript('window.meshPixels()')
    fs.writeFileSync('build/mesh-flow-preview.png', (await win.webContents.capturePage()).toPNG())
    win.setSize(520, 800)
    await win.webContents.executeJavaScript('window.checkMeshResize()')
    win.setSize(1920, 1080)
    await win.webContents.executeJavaScript('window.checkMeshResize()')
    await win.webContents.executeJavaScript('window.checkMeshDisposal()')
    console.log(
      'Mesh background: portrait/large resize, fallback resolution, context loss and disposal passed.'
    )
    win.destroy()
    app.exit(0)
  } catch (reason) {
    console.error(reason)
    app.exit(1)
  }
})
