/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- macOS package verification. */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { verifyMacosRuntime, assertArchitecture } = require('./macos-runtime.cjs')

if (process.platform !== 'darwin') throw new Error('Verify the Mac package on macOS')
const app = path.resolve(process.argv[2] || 'dist/mac-arm64/EasyPlayer.app')
const arch = process.argv[3] || 'arm64'
const contents = path.join(app, 'Contents')
const resources = path.join(contents, 'Resources')
const native = path.join(resources, 'native')
const execute = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}
const executable = path.join(
  contents,
  'MacOS',
  execute('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleExecutable',
    path.join(contents, 'Info.plist')
  ])
)
assertArchitecture(executable, arch)
const result = verifyMacosRuntime(native, arch, path.resolve(__dirname, '..'))
for (const file of fs.readdirSync(native))
  if (/\.(dll|exe)$/.test(file)) throw new Error(`Windows runtime in Mac package: ${file}`)
const ytManifest = JSON.parse(
  fs.readFileSync(path.join(resources, 'lib/yt-dlp/yt-dlp.manifest.json'), 'utf8')
)
const lock = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../resources/lib/ytdlp-release.json'), 'utf8')
)
if (
  ytManifest.version !== lock.version ||
  ytManifest.sha256 !== lock.assets['yt-dlp_macos'].sha256 ||
  ytManifest.platform !== 'darwin' ||
  ytManifest.arch !== 'universal'
)
  throw new Error('Mac yt-dlp does not match the official release lock')
const yt = path.join(resources, 'lib/yt-dlp/yt-dlp')
assertArchitecture(yt, arch)
if (execute(yt, ['--version']) !== lock.version) throw new Error('Mac yt-dlp version mismatch')
execute('codesign', ['--verify', '--strict', yt])
// App signing may legitimately change Mach-O signature bytes. The original
// official yt-dlp digest is checked before packaging, then the signed artifact
// is verified here by version, architecture and code signature.
const code = `(async()=>{const path=require('node:path'),{createRequire}=require('node:module');const resources=process.argv[1];const req=createRequire(path.join(resources,'app.asar/package.json'));const engine=new(require(path.join(resources,'native/easy_player_native.node')).AudioEngine)();engine.stop();const DB=req('better-sqlite3'),db=new DB(':memory:');if(db.prepare('select 1 as ok').get().ok!==1)throw Error('SQLite failed');db.close();const sharp=req('sharp'),buffer=await sharp({create:{width:2,height:3,channels:3,background:'#123456'}}).png().toBuffer();if((await sharp(buffer).metadata()).height!==3)throw Error('Sharp failed');console.log(JSON.stringify({platform:process.platform,arch:process.arch,electron:process.versions.electron,audioEngine:true,sqlite:true,sharp:true}));})().catch(error=>{console.error(error);process.exitCode=1})`
const smoke = execute(executable, ['-e', code, resources], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin:/bin' }
})
console.log(smoke)
console.log(
  `Mac ${arch} package verified: ${(result.bytes / 1024 ** 2).toFixed(2)} MiB native audio runtime; pinned dylibs, signatures, yt-dlp, SQLite and Sharp passed`
)
