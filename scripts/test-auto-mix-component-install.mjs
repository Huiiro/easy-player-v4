import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'

const root = path.resolve('.')
const directory = await fs.mkdtemp(path.join(root, 'build', 'component-install-check-'))
const oldDataRoot = process.env.EASY_PLAYER_DATA_DIR
try {
  process.env.EASY_PLAYER_DATA_DIR = directory
  const manifest = JSON.parse(
    await fs.readFile(`dist/easy-player-auto-mix-${process.platform}-${process.arch}.json`, 'utf8')
  )
  const archive = path.resolve('dist', manifest.asset)
  globalThis.componentTestFetch = async (url) =>
    url.endsWith('.json')
      ? new Response(JSON.stringify(manifest))
      : new Response(Readable.toWeb(createReadStream(archive)))
  const file = path.join(directory, 'manager.cjs')
  await build({
    stdin: {
      contents: `export {createAutoMixRuntimeManager} from './src/main/service/autoMixRuntimeManager'; export {setMainDirectory} from './src/main/utils/pathUtils';`,
      resolveDir: root
    },
    outfile: file,
    platform: 'node',
    format: 'cjs',
    bundle: true,
    plugins: [
      {
        name: 'test-electron',
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: 'electron',
            namespace: 'test-electron'
          }))
          builder.onLoad({ filter: /.*/, namespace: 'test-electron' }, () => ({
            contents:
              'export const app={isPackaged:false,once:()=>{},getVersion:()=>"3.3.1"}; export const net={fetch:(url)=>globalThis.componentTestFetch(url)};'
          }))
        }
      }
    ]
  })
  const { createAutoMixRuntimeManager, setMainDirectory } = createRequire(import.meta.url)(file)
  setMainDirectory(path.join(root, 'out/main'))
  const manager = createAutoMixRuntimeManager(() => {})
  assert.equal(manager.status().installed, false)
  manager.start()
  await manager.wait()
  assert.equal(manager.status().phase, 'ready', manager.status().error)
  const componentRoot = path.join(directory, 'player_data/components/auto-mix')
  const installed = JSON.parse(
    await fs.readFile(path.join(componentRoot, 'installed.json'), 'utf8')
  )
  const runtime = path.join(componentRoot, 'versions', installed.directory)
  const result = spawnSync(
    process.execPath,
    [
      'scripts/test-bundled-auto-mix.mjs',
      process.argv[2] ||
        (process.platform === 'darwin'
          ? 'dist/mac-arm64/EasyPlayer.app/Contents/Resources'
          : 'dist/win-unpacked/resources'),
      runtime
    ],
    { stdio: 'inherit', windowsHide: true, timeout: 300_000 }
  )
  assert.ifError(result.error)
  assert.equal(result.status, 0)
  const stemCache = path.join(directory, 'player_data/auto-mix-stems')
  await fs.mkdir(stemCache, { recursive: true })
  await fs.writeFile(path.join(stemCache, 'generated.wav'), 'fixture')
  assert.equal((await manager.clearCache()).success, true)
  assert.equal(manager.status().installed, true)
  await fs.access(
    path.join(runtime, process.platform === 'darwin' ? 'python/bin/python3' : 'python/python.exe')
  )
  await fs.mkdir(stemCache, { recursive: true })
  await fs.writeFile(path.join(stemCache, 'generated.wav'), 'preserve')
  assert.equal((await manager.uninstall()).installed, false)
  await assert.rejects(fs.access(componentRoot))
  assert.equal(await fs.readFile(path.join(stemCache, 'generated.wav'), 'utf8'), 'preserve')
  console.log(
    'Real optional ZIP: download, install, inference, cache clearing and uninstall passed'
  )
} finally {
  if (oldDataRoot === undefined) delete process.env.EASY_PLAYER_DATA_DIR
  else process.env.EASY_PLAYER_DATA_DIR = oldDataRoot
  delete globalThis.componentTestFetch
  assert.equal(path.dirname(directory), path.join(root, 'build'))
  assert.ok(path.basename(directory).startsWith('component-install-check-'))
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
