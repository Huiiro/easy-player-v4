/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { readFileSync, existsSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { app } = require('electron')

const saved = new Map()
let failSave = false
const cache = new Map()
function load(filename) {
  filename = path.resolve(filename)
  if (filename.endsWith(path.join('repository', 'settings.ts')))
    return {
      getAppSetting: (key) => saved.get(key) ?? null,
      setAppSetting: (key, value) => {
        if (failSave) throw new Error('Disk full')
        saved.set(key, value)
      }
    }
  if (cache.has(filename)) return cache.get(filename)
  const exports = {}
  cache.set(filename, exports)
  vm.runInNewContext(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      URL,
      Error,
      require(name) {
        if (!name.startsWith('.')) return require(name)
        const target = path.resolve(path.dirname(filename), name)
        return load(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'))
      }
    },
    { filename }
  )
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const target = createServer((_request, response) => response.end('direct'))
const received = []
const proxy = createServer((request, response) => {
  received.push(request.url)
  if (request.url.includes('/slow')) return
  response.end('proxied')
})
proxy.on('connect', (request, socket) => {
  received.push(`CONNECT ${request.url}`)
  socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
})
const timeout = setTimeout(() => {
  console.error('Plugin proxy tests timed out')
  app.exit(1)
}, 30000)

app.whenReady().then(async () => {
  try {
    const { normalizePluginProxy } = load('src/shared/pluginProxy.ts')
    for (const url of [
      '',
      'ftp://localhost:21',
      'http://user:password@localhost:8080',
      'http://localhost:8080/path',
      'http://localhost:8080?secret=1',
      'http://localhost:99999',
      'http://localhost:0',
      'http://localhost;direct',
      'http://localhost:8080#fragment'
    ])
      assert.throws(() => normalizePluginProxy({ enabled: true, url }))
    assert.throws(() => normalizePluginProxy({ enabled: 'true', url: 'http://localhost' }))
    assert.equal(
      normalizePluginProxy({ enabled: true, url: ' http://localhost:80/ ' }).url,
      'http://localhost'
    )
    assert.equal(
      normalizePluginProxy({ enabled: true, url: 'socks5://[::1]:1080' }).url,
      'socks5://[::1]:1080'
    )
    await Promise.all([listen(target), listen(proxy)])
    const api = load('src/main/plugins/proxy.ts')
    await api.initializePluginProxy()
    const directUrl = `http://127.0.0.1:${target.address().port}/`
    assert.equal(await (await api.pluginFetch(directUrl)).text(), 'direct')
    const url = `http://127.0.0.1:${proxy.address().port}`
    await api.savePluginProxySettings({ enabled: true, url })
    // Loopback must also pass through the proxy when explicitly enabled.
    assert.equal(await (await api.pluginFetch(directUrl)).text(), 'proxied')
    assert.equal(received.at(-1), directUrl)
    const remoteUrl = 'http://plugin-proxy-test.invalid/catalog'
    assert.equal(await (await api.pluginFetch(remoteUrl)).text(), 'proxied')
    assert.equal(received.at(-1), remoteUrl)
    await assert.rejects(
      api.pluginFetch('https://plugin-proxy-test.invalid/catalog', {
        signal: AbortSignal.timeout(5000)
      })
    )
    assert(received.includes('CONNECT plugin-proxy-test.invalid:443'))
    assert.deepEqual(plain(api.pluginProxyArguments()), ['--proxy', url])
    const controller = new AbortController()
    const request = api.pluginFetch('http://plugin-proxy-test.invalid/slow', {
      signal: controller.signal
    })
    controller.abort()
    await assert.rejects(request)
    failSave = true
    await assert.rejects(api.savePluginProxySettings({ enabled: false, url }))
    assert.equal(api.getPluginProxySettings().enabled, true)
    assert.equal(await (await api.pluginFetch(remoteUrl)).text(), 'proxied')
    failSave = false
    await api.initializePluginProxy()
    assert.deepEqual(plain(api.getPluginProxySettings()), { enabled: true, url })
    assert.equal(await (await api.pluginFetch(remoteUrl)).text(), 'proxied')
    await api.savePluginProxySettings({ enabled: true, url: 'socks5://127.0.0.1:1080' })
    assert.match(await api.getPluginSession().resolveProxy(remoteUrl), /SOCKS5 127\.0\.0\.1:1080/)
    await api.savePluginProxySettings({ enabled: false, url })
    assert.equal(await (await api.pluginFetch(directUrl)).text(), 'direct')
    assert.deepEqual(plain(api.pluginProxyArguments()), ['--proxy', ''])
    await api.initializePluginProxy()
    assert.deepEqual(plain(api.getPluginProxySettings()), { enabled: false, url })
    assert.equal(await (await api.pluginFetch(directUrl)).text(), 'direct')
    console.log(
      'Plugin proxy tests passed: validation, forwarding, cancellation, persistence, SOCKS5 and direct mode'
    )
    clearTimeout(timeout)
    app.exit(0)
  } catch (error) {
    console.error(error)
    clearTimeout(timeout)
    app.exit(1)
  }
})
