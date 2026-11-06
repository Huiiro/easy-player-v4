/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { readFileSync, existsSync, mkdirSync, mkdtempSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { app, session } = require('electron')
const Database = require('better-sqlite3')
mkdirSync('build', { recursive: true })
const storage = mkdtempSync(path.resolve('build/plugin-proxy-storage-'))
app.setPath('userData', storage)
app.commandLine.appendSwitch('disable-background-networking')
const databasePath = path.join(storage, 'settings.sqlite')
let database = new Database(databasePath)
database.exec(`CREATE TABLE app_setting (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`)
const configurations = []
let systemRule
const testElectron = {
  session: {
    fromPartition(...args) {
      const real = session.fromPartition(...args)
      return {
        setProxy(config) {
          configurations.push(config)
          return real.setProxy(config)
        },
        fetch: (...args) => real.fetch(...args),
        resolveProxy: (...args) =>
          systemRule === undefined ? real.resolveProxy(...args) : Promise.resolve(systemRule)
      }
    }
  }
}

let failSave = false
const cache = new Map()
function load(filename) {
  filename = path.resolve(filename)
  if (filename === path.resolve('src/main/database/colors.ts'))
    return {
      getDatabase: () => {
        if (failSave) throw new Error('Disk full')
        return database
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
        if (name === 'electron') return testElectron
        if (!name.startsWith('.')) return require(name)
        const target = path.resolve(path.dirname(filename), name)
        return load(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'colors.ts'))
      }
    },
    { filename }
  )
  return exports
}
async function restartProxy() {
  database.close()
  database = new Database(databasePath)
  cache.delete(path.resolve('src/main/plugins/proxy.ts'))
  const fresh = load('src/main/plugins/proxy.ts')
  await fresh.initializePluginProxy()
  return fresh
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
    assert.deepEqual(plain(normalizePluginProxy({ enabled: true, url: 'http://localhost:7890' })), {
      mode: 'custom',
      url: 'http://localhost:7890'
    })
    assert.deepEqual(plain(normalizePluginProxy({ enabled: false, url: '' })), {
      mode: 'direct',
      url: ''
    })
    assert.throws(() => normalizePluginProxy({ mode: 'invalid', url: '' }))
    assert.deepEqual(plain(normalizePluginProxy({ mode: 'system', url: '' })), {
      mode: 'system',
      url: ''
    })
    await Promise.all([listen(target), listen(proxy)])
    let api = load('src/main/plugins/proxy.ts')
    await api.initializePluginProxy()
    const directUrl = `http://127.0.0.1:${target.address().port}/`
    assert.equal(await (await api.pluginFetch(directUrl)).text(), 'direct')
    const url = `http://127.0.0.1:${proxy.address().port}`
    await api.savePluginProxySettings({ enabled: true, url })
    // Loopback must also pass through the proxy when explicitly enabled.
    assert.equal(await (await api.pluginFetch(directUrl)).text(), 'proxied')
    assert(received.includes(directUrl))
    const remoteUrl = 'http://plugin-proxy-test.invalid/catalog'
    assert.equal(await (await api.pluginFetch(remoteUrl)).text(), 'proxied')
    assert(received.includes(remoteUrl))
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
    assert.equal(api.getPluginProxySettings().mode, 'custom')
    assert.equal(await (await api.pluginFetch(remoteUrl)).text(), 'proxied')
    failSave = false
    api = await restartProxy()
    assert.deepEqual(plain(api.getPluginProxySettings()), { mode: 'custom', url })
    assert.equal(await (await api.pluginFetch(remoteUrl)).text(), 'proxied')
    await api.savePluginProxySettings({ enabled: true, url: 'socks5://127.0.0.1:1080' })
    assert.match(await api.getPluginSession().resolveProxy(remoteUrl), /SOCKS5 127\.0\.0\.1:1080/)
    await api.savePluginProxySettings({ enabled: false, url })
    assert.equal(await (await api.pluginFetch(directUrl)).text(), 'direct')
    assert.deepEqual(plain(api.pluginProxyArguments()), ['--proxy', ''])
    api = await restartProxy()
    assert.deepEqual(plain(api.getPluginProxySettings()), { mode: 'direct', url })
    assert.equal(await (await api.pluginFetch(directUrl)).text(), 'direct')
    await api.savePluginProxySettings({ mode: 'system', url: '' })
    assert.deepEqual(plain(configurations.at(-1)), { mode: 'system' })
    api = await restartProxy()
    assert.equal(api.getPluginProxySettings().mode, 'system')
    const realResolveProxy = api.getPluginSession().resolveProxy
    const resolvedUrls = []
    api.getPluginSession().resolveProxy = (url) => {
      resolvedUrls.push(url)
      return realResolveProxy(url)
    }
    for (const [rule, expected] of [
      ['PROXY localhost:7890', 'http://localhost:7890'],
      ['HTTPS localhost:7890; DIRECT', 'https://localhost:7890'],
      ['SOCKS5 [::1]:1080', 'socks5://[::1]:1080'],
      ['SOCKS localhost:1080', 'socks4://localhost:1080'],
      ['DIRECT', '']
    ]) {
      systemRule = rule
      assert.deepEqual(plain(await api.pluginProxyArguments('https://media.example/video')), [
        '--proxy',
        expected
      ])
      assert.equal(resolvedUrls.at(-1), 'https://media.example/video')
    }
    await api.pluginProxyArguments('ytsearch3:test')
    assert.equal(resolvedUrls.at(-1), 'https://www.youtube.com/')
    systemRule = 'INVALID'
    await assert.rejects(api.pluginProxyArguments())
    systemRule = undefined
    console.log(
      'Plugin proxy tests passed: validation, forwarding, cancellation, migration, persistence and system/custom/direct modes'
    )
    clearTimeout(timeout)
    app.exit(0)
  } catch (error) {
    console.error(error)
    clearTimeout(timeout)
    app.exit(1)
  }
})
