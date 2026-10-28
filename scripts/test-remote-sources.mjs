/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const temporary = await mkdtemp(join(tmpdir(), 'easy-player-nas-'))
const output = join(temporary, 'providers.mjs')
await build({
  entryPoints: ['src/main/service/nasProviders.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['ssh2'],
  plugins: [
    {
      name: 'background-work',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/playbackMode$/ }, () => ({
          path: 'background',
          namespace: 'fixture'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export async function waitForBackgroundWork() {}'
        }))
      }
    }
  ]
})
const { webdavProvider, smbProvider } = await import(pathToFileURL(output).href)
await build({
  entryPoints: ['src/shared/remoteSources.ts'],
  outfile: join(temporary, 'model.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm'
})
const { isRemoteConnection, normalizeRemoteConnection, REMOTE_PROTOCOLS } = await import(
  pathToFileURL(join(temporary, 'model.mjs')).href
)
const audio = Buffer.from('audio fixture')
let mode = 'normal'
let authorization = `Basic ${Buffer.from('user:secret').toString('base64')}`
const requests = []
const resource = (href, collection = false) =>
  `<x:response><x:href>${href}</x:href><x:propstat><x:prop><x:resourcetype>${collection ? '<x:collection/>' : ''}</x:resourcetype><x:getcontentlength>${audio.length}</x:getcontentlength></x:prop><x:status>HTTP/1.1 200 OK</x:status></x:propstat><x:propstat><x:prop/><x:status>HTTP/1.1 404 Not Found</x:status></x:propstat></x:response>`
const server = createServer((request, response) => {
  requests.push({ url: request.url, method: request.method, depth: request.headers.depth })
  if (request.headers.authorization !== authorization) {
    if (request.url.startsWith('/rest/ping.view')) {
      response.end(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1' } }))
      return
    }
    if (request.url === '/Users/AuthenticateByName') {
      response.end(JSON.stringify({ AccessToken: 'fixture-token' }))
      return
    }
    if (request.url === '/System/Info' && request.headers['x-emby-token'] === 'fixture-token') {
      response.end(JSON.stringify({ Version: '10.10' }))
      return
    }
    response.writeHead(401).end()
    return
  }
  if (request.method === 'GET') {
    response.end(audio)
    return
  }
  if (mode === 'denied') {
    response.writeHead(403).end()
    return
  }
  if (mode === 'redirect') {
    response.writeHead(302, { Location: '/private/' }).end()
    return
  }
  if (mode === 'invalid') {
    response.writeHead(207).end('<html/>')
    return
  }
  if (mode === 'entity') {
    response.writeHead(207).end('<!DOCTYPE foo [<!ENTITY test "bad">]><x/>')
    return
  }
  let entries
  if (mode === 'escape') entries = resource('http://other.invalid/music/secret.mp3')
  else if (mode === 'traversal') entries = resource('/music/%2e%2e/private/file.mp3')
  else if (request.headers.depth === '0') entries = resource('/music/', true)
  else if (request.url === '/music/album/')
    entries = resource('/music/album/', true) + resource('/music/album/%E4%B8%AD%20%26%20song.flac')
  else
    entries =
      resource('/music/', true) +
      resource('/music/album/', true) +
      resource('/music/a_b.mp3') +
      resource('/music/a%20b.mp3') +
      resource('/music/readme.txt')
  response
    .writeHead(207, { 'Content-Type': 'application/xml' })
    .end(`<x:multistatus xmlns:x="DAV:">${entries}</x:multistatus>`)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const config = {
  type: 'webdav',
  baseUrl: `http://127.0.0.1:${server.address().port}/music`,
  auth: { type: 'basic', username: 'user', password: 'secret' }
}
try {
  for (const protocol of REMOTE_PROTOCOLS) {
    const auth =
      protocol.authTypes[0] === 'system'
        ? { type: 'system' }
        : { type: protocol.authTypes[0], username: 'user', password: 'secret' }
    assert(
      isRemoteConnection({
        type: protocol.id,
        baseUrl: protocol.placeholder,
        auth,
        hostKey: 'SHA256:' + 'A'.repeat(43)
      })
    )
  }
  assert.equal(isRemoteConnection({ ...config, type: 'unknown' }), false)
  assert.equal(isRemoteConnection({ ...config, type: 'navidrome' }), false)
  assert.equal(isRemoteConnection({ ...config, auth: { type: 'anonymous' } }), true)
  assert.equal(
    normalizeRemoteConnection({
      type: 'webdav',
      baseUrl: config.baseUrl,
      user: 'user',
      secret: 'secret'
    }).auth.type,
    'basic'
  )
  await webdavProvider.test(config)
  const tracks = await webdavProvider.listTracks(config)
  assert.equal(tracks.length, 3)
  assert.equal(tracks.find((track) => track.format === 'flac').title, '中 & song')
  assert.equal(new Set(tracks.map((track) => track.id)).size, 3)
  assert.deepEqual(
    Buffer.from(await (await webdavProvider.fetchStream(config, tracks[0].id)).arrayBuffer()),
    audio
  )
  assert(requests.some((request) => request.depth === '0'))
  assert(requests.some((request) => request.depth === '1'))
  await assert.rejects(
    webdavProvider.test({ ...config, auth: { ...config.auth, password: 'wrong' } }),
    /401/
  )
  authorization = 'Bearer fixture-bearer'
  await webdavProvider.test({ ...config, auth: { type: 'bearer', token: 'fixture-bearer' } })
  authorization = undefined
  await webdavProvider.test({ ...config, auth: { type: 'anonymous' } })
  authorization = `Basic ${Buffer.from('user:secret').toString('base64')}`
  for (mode of ['denied', 'redirect', 'invalid', 'entity', 'escape', 'traversal']) {
    await assert.rejects(webdavProvider.listTracks(config), undefined, mode)
  }
  await assert.rejects(webdavProvider.fetchStream(config, '../secret.mp3'), /outside/)
  const share = join(temporary, 'share')
  await mkdir(join(share, 'album'), { recursive: true })
  await writeFile(join(share, 'album', '中 & song.flac'), audio)
  await writeFile(join(share, 'readme.txt'), 'ignore')
  await writeFile(join(temporary, 'outside.mp3'), audio)
  const smb = { type: 'smb', baseUrl: share, auth: { type: 'system' } }
  await smbProvider.test(smb)
  const files = await smbProvider.listTracks(smb)
  assert.equal(files.length, 1)
  assert.equal(files[0].id, 'album/中 & song.flac')
  assert.deepEqual(
    Buffer.from(await (await smbProvider.fetchStream(smb, files[0].id)).arrayBuffer()),
    audio
  )
  await assert.rejects(smbProvider.fetchStream(smb, '../outside.mp3'), /outside/)
  await assert.rejects(smbProvider.test({ ...smb, baseUrl: 'relative/path' }), /absolute/)
  await assert.rejects(
    smbProvider.test({ ...smb, baseUrl: join(share, 'readme.txt') }),
    /directory/
  )

  // Exercise the actual orchestration, index writes and cache with isolated host services.
  const fixtures = {
    './fileTransferProviders':
      'export const ftpProvider = {}, ftpsProvider = {}, implicitFtpsProvider = {}, sftpProvider = {}',
    './playbackMode': 'export async function waitForBackgroundWork() {}',
    './operationLogger':
      'export const logError = e => String(e); export const logUrl = u => u; export const logOperation = (_name, _context, task) => task()',
    './loggerService': 'export const Logger = { debug(){}, warn(){}, error(){} }',
    '../i18n': 'export const t = key => key',
    '../utils/pathUtils': 'export const getDataPath = () => globalThis.remoteFixture.directory',
    '../database/newestSongs': 'export function refreshNewestSongs() {}',
    '../database/repository': `export const getSource = () => globalThis.remoteFixture.source;
      export const getSong = id => globalThis.remoteFixture.songs[id - 1];
      export const getAppSetting = key => key === 'remote.cache-limit-gb' ? 0 : null;
      export function touchSource() {} export function updateSourceStats() {}`,
    '../database': `export const getDatabase = () => ({ prepare(sql) { return {
      get() { return { id: 1 } },
      run(...args) { if (sql.startsWith('INSERT INTO song')) globalThis.remoteFixture.songs.push({
        id: globalThis.remoteFixture.songs.length + 1, sourceId: args[18], remoteId: args[19], format: args[13], fileName: args[14]
      }); return { lastInsertRowid: 1 } }
    } } })`
  }
  await build({
    entryPoints: ['src/main/service/remoteSourceService.ts'],
    outfile: join(temporary, 'service.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['ssh2'],
    plugins: [
      {
        name: 'host-fixtures',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            fixtures[args.path] ? { path: args.path, namespace: 'host' } : undefined
          )
          builder.onLoad({ filter: /.*/, namespace: 'host' }, (args) => ({
            contents: fixtures[args.path]
          }))
        }
      }
    ]
  })
  globalThis.remoteFixture = {
    source: { ...config, id: 7, name: 'NAS' },
    directory: temporary,
    songs: []
  }
  const service = await import(pathToFileURL(join(temporary, 'service.mjs')).href)
  mode = 'normal'
  assert.deepEqual(await service.syncRemoteSource(7), { imported: 3, total: 3 })
  assert.equal(globalThis.remoteFixture.songs.length, 3)
  const first = service.cacheRemoteSong(1)
  assert.equal(service.cacheRemoteSong(1), first, 'concurrent downloads share one task')
  const cached = await first
  assert.deepEqual(await (await import('node:fs/promises')).readFile(cached), audio)
  assert.equal(await service.cacheRemoteSong(1), cached)
  const second = await service.cacheRemoteSong(2)
  assert.notEqual(second, cached, 'different file paths cannot collide in the cache')
  assert.deepEqual(await (await import('node:fs/promises')).readFile(second), audio)
  const baseUrl = config.baseUrl.replace('/music', '')
  for (const type of ['navidrome', 'subsonic', 'jellyfin'])
    assert(
      (
        await service.testRemoteSource({
          ...config,
          type,
          baseUrl,
          auth: { type: 'password', username: 'user', password: 'secret' }
        })
      ).version
    )
  const authRequests = requests.filter(
    (request) => request.url === '/Users/AuthenticateByName'
  ).length
  assert.equal(
    (
      await service.testRemoteSource({
        type: 'jellyfin',
        baseUrl,
        auth: { type: 'api-key', token: 'fixture-token' }
      })
    ).version,
    '10.10'
  )
  assert.equal(
    requests.filter((request) => request.url === '/Users/AuthenticateByName').length,
    authRequests,
    'API key authentication must skip the password endpoint'
  )
  delete globalThis.remoteFixture
  console.log(
    'Remote source protocols: WebDAV HTTP fixture, authentication, recursion, Unicode, bounds and mounted SMB passed'
  )
} finally {
  await new Promise((resolve) => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
