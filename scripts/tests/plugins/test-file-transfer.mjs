/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:net'
import { createServer as createTlsServer, createSecureContext, TLSSocket } from 'node:tls'
import { generate } from 'selfsigned'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { generateKeyPairSync, createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import ssh2 from 'ssh2'

// Start a child with a process-scoped test CA; production verification remains enabled.
if (!process.env.EASY_PLAYER_NAS_TEST_CERT) {
  const directory = await mkdtemp(join(tmpdir(), 'easy-player-ftps-ca-'))
  try {
    const certificate = await generate([{ name: 'commonName', value: 'NAS test' }], {
      extensions: [
        { name: 'basicConstraints', cA: true },
        { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }
      ]
    })
    const file = join(directory, 'certificate.json')
    const ca = join(directory, 'ca.pem')
    await writeFile(file, JSON.stringify(certificate))
    await writeFile(ca, certificate.cert)
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: { ...process.env, NODE_EXTRA_CA_CERTS: ca, EASY_PLAYER_NAS_TEST_CERT: file }
    })
    if (result.status !== 0) throw new Error(`TLS protocol tests failed: ${result.status}`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  process.exit(0)
}
const certificate = JSON.parse(await readFile(process.env.EASY_PLAYER_NAS_TEST_CERT, 'utf8'))
const tlsOptions = { key: certificate.private, cert: certificate.cert }
const secureContext = createSecureContext(tlsOptions)
const temporary = await mkdtemp(join(tmpdir(), 'easy-player-transfer-'))
const outfile = join(temporary, 'transfer.cjs')
await build({
  entryPoints: ['src/main/service/fileTransferProviders.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'host',
      setup(builder) {
        builder.onResolve({ filter: /^ssh2$/ }, () => ({
          path: resolve('node_modules/ssh2/lib/index.js'),
          external: true
        }))
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
const { ftpProvider, ftpsProvider, implicitFtpsProvider, sftpProvider, transferPath } =
  createRequire(import.meta.url)(outfile)
const bytes = Buffer.from('remote audio fixture')
const sockets = new Set()
const dataServers = new Set()
const serveFtp = (socket, secured = false, greeting = true) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
  socket.on('error', () => {})
  if (greeting) socket.write('220 NAS fixture\r\n')
  let buffer = ''
  let username = ''
  let authenticated = false
  let dataConnection
  socket.on('data', async (chunk) => {
    buffer += chunk.toString()
    while (buffer.includes('\r\n')) {
      const end = buffer.indexOf('\r\n')
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const [command, ...parts] = line.split(' ')
      const argument = parts.join(' ')
      const reply = (text) => socket.write(text + '\r\n')
      if (command === 'USER') {
        username = argument
        reply('331 Password')
        continue
      }
      if (command === 'PASS') {
        authenticated = username === 'anonymous' || (username === 'user' && argument === 'secret')
        reply(authenticated ? '230 Logged in' : '530 Invalid credentials')
        continue
      }
      if (command === 'AUTH') {
        reply('234 Begin TLS')
        socket.removeAllListeners('data')
        serveFtp(new TLSSocket(socket, { isServer: true, secureContext }), true, false)
        return
      }
      if (command === 'QUIT') {
        reply('221 Bye')
        socket.end()
        continue
      }
      if (!authenticated) {
        reply('530 Login required')
        continue
      }
      if (command === 'FEAT') {
        reply('211-Features\r\n MLST type*;size*;modify*;\r\n UTF8\r\n211 End')
        continue
      }
      if (command === 'PWD') {
        reply('257 "/music"')
        continue
      }
      if (['TYPE', 'OPTS', 'STRU', 'CWD', 'PBSZ', 'PROT'].includes(command)) {
        reply('200 OK')
        continue
      }
      if (command === 'EPSV') {
        const dataServer = secured ? createTlsServer(tlsOptions) : createServer()
        dataServers.add(dataServer)
        dataConnection = new Promise((resolve) =>
          dataServer.once(secured ? 'secureConnection' : 'connection', (data) => {
            sockets.add(data)
            data.on('error', () => {})
            data.on('close', () => sockets.delete(data))
            resolve(data)
          })
        )
        await new Promise((resolve) => dataServer.listen(0, '127.0.0.1', resolve))
        reply(`229 Entering Extended Passive Mode (|||${dataServer.address().port}|)`)
        continue
      }
      if (command === 'MLSD' || command === 'LIST' || command === 'RETR') {
        reply('150 Opening data channel')
        const data = await dataConnection
        const listing =
          argument === '/music/album'
            ? `type=file;size=${bytes.length};modify=20260101000000; 中 & song.flac\r\n`
            : 'type=dir;size=0;modify=20260101000000; album\r\ntype=file;size=10;modify=20260101000000; readme.txt\r\n'
        data.end(command === 'RETR' ? bytes : listing, () => reply('226 Transfer complete'))
        continue
      }
      reply('502 Unknown command')
    }
  })
}
const ftp = createServer((socket) => serveFtp(socket))
const implicitFtp = createTlsServer(tlsOptions, (socket) => serveFtp(socket, true))
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs1',
  format: 'pem'
})
const hostKey =
  'SHA256:' +
  createHash('sha256')
    .update(ssh2.utils.parseKey(privateKey).getPublicSSH())
    .digest('base64')
    .replace(/=+$/, '')
const clientKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs1',
  format: 'pem',
  cipher: 'aes-256-cbc',
  passphrase: 'key-passphrase'
})
const publicKey = ssh2.utils.parseKey(clientKey, 'key-passphrase').getPublicSSH()
const ssh = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
  client.on('error', () => {})
  client.on('authentication', (context) => {
    if (
      context.username === 'user' &&
      ((context.method === 'password' && context.password === 'secret') ||
        (context.method === 'publickey' && context.key.data.equals(publicKey)))
    )
      context.accept()
    else context.reject()
  })
  client.on('ready', () =>
    client.on('session', (accept) =>
      accept().on('sftp', (acceptSftp) => {
        const sftp = acceptSftp()
        const handles = new Map()
        let counter = 0
        const attrs = (directory) => ({
          mode: directory ? 0o40755 : 0o100644,
          size: directory ? 0 : bytes.length,
          uid: 1,
          gid: 1,
          atime: 1,
          mtime: 1
        })
        const handle = (request, value) => {
          const buffer = Buffer.alloc(4)
          buffer.writeUInt32BE(++counter)
          handles.set(counter, value)
          sftp.handle(request, buffer)
        }
        sftp.on('REALPATH', (request, path) =>
          sftp.name(request, [
            {
              filename: path === '/music/escape.mp3' ? '/private/escape.mp3' : path,
              longname: '',
              attrs: attrs(true)
            }
          ])
        )
        sftp.on('STAT', (request, path) => sftp.attrs(request, attrs(!path.endsWith('.flac'))))
        sftp.on('OPENDIR', (request, path) =>
          handle(request, { path, directory: true, read: false })
        )
        sftp.on('READDIR', (request, buffer) => {
          const handle = handles.get(buffer.readUInt32BE())
          if (handle.read) {
            sftp.status(request, 1)
            return
          }
          handle.read = true
          const entries =
            handle.path === '/music'
              ? [{ filename: 'album', longname: '', attrs: attrs(true) }]
              : [{ filename: '中 & song.flac', longname: '', attrs: attrs(false) }]
          sftp.name(request, entries)
        })
        sftp.on('OPEN', (request, path) => handle(request, { path }))
        sftp.on('READ', (request, _handle, offset, length) => {
          if (offset >= bytes.length) sftp.status(request, 1)
          else sftp.data(request, bytes.subarray(offset, offset + length))
        })
        sftp.on('CLOSE', (request, buffer) => {
          handles.delete(buffer.readUInt32BE())
          sftp.status(request, 0)
        })
      })
    )
  )
})
await Promise.all([
  new Promise((resolve) => ftp.listen(0, '127.0.0.1', resolve)),
  new Promise((resolve) => implicitFtp.listen(0, '127.0.0.1', resolve)),
  new Promise((resolve) => ssh.listen(0, '127.0.0.1', resolve))
])
try {
  const auth = { type: 'password', username: 'user', password: 'secret' }
  const config = { type: 'ftp', baseUrl: `ftp://127.0.0.1:${ftp.address().port}/music/`, auth }
  await ftpProvider.test(config)
  const tracks = await ftpProvider.listTracks(config)
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].title, '中 & song')
  assert.deepEqual(
    Buffer.from(await (await ftpProvider.fetchStream(config, tracks[0].id)).arrayBuffer()),
    bytes
  )
  await ftpProvider.test({ ...config, auth: { type: 'anonymous' } })
  await assert.rejects(ftpProvider.test({ ...config, auth: { ...auth, password: 'wrong' } }), /530/)
  const explicit = { ...config, type: 'ftps', baseUrl: config.baseUrl.replace('ftp:', 'ftps:') }
  const implicit = {
    ...config,
    type: 'ftps-implicit',
    baseUrl: `ftps://127.0.0.1:${implicitFtp.address().port}/music/`
  }
  for (const [provider, config] of [
    [ftpsProvider, explicit],
    [implicitFtpsProvider, implicit]
  ]) {
    await provider.test(config)
    const tracks = await provider.listTracks(config)
    assert.equal(tracks.length, 1)
    assert.deepEqual(
      Buffer.from(await (await provider.fetchStream(config, tracks[0].id)).arrayBuffer()),
      bytes
    )
  }
  assert.throws(() => transferPath('/music', '../private/file'), /Invalid/)
  const sftp = {
    type: 'sftp',
    baseUrl: `sftp://127.0.0.1:${ssh.address().port}/music`,
    hostKey,
    auth
  }
  await sftpProvider.test(sftp)
  const files = await sftpProvider.listTracks(sftp)
  assert.equal(files[0].id, 'album/中 & song.flac')
  assert.deepEqual(
    Buffer.from(await (await sftpProvider.fetchStream(sftp, files[0].id)).arrayBuffer()),
    bytes
  )
  await sftpProvider.test({
    ...sftp,
    auth: {
      type: 'private-key',
      username: 'user',
      privateKey: clientKey,
      passphrase: 'key-passphrase'
    }
  })
  await assert.rejects(sftpProvider.test({ ...sftp, auth: { ...auth, password: 'wrong' } }))
  await assert.rejects(
    sftpProvider.test({ ...sftp, hostKey: 'SHA256:' + 'A'.repeat(43) }),
    /verification/i
  )
  await assert.rejects(sftpProvider.fetchStream(sftp, 'escape.mp3'), /outside/)
  console.log(
    'FTP and SFTP real server tests passed: password, anonymous, encrypted private key, recursion, downloads, host identity and path bounds; explicit and implicit FTPS TLS transfers'
  )
} finally {
  for (const socket of sockets) socket.destroy()
  for (const server of dataServers) server.close()
  await Promise.all([
    new Promise((resolve) => ftp.close(resolve)),
    new Promise((resolve) => ssh.close(resolve)),
    new Promise((resolve) => implicitFtp.close(resolve))
  ])
  await rm(temporary, { recursive: true, force: true })
}
