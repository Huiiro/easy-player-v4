/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain JavaScript test runner. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
const source = await fs.readFile('src/main/service/autoMixStemService.ts', 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText
const { AutoMixStemService } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
)
const python = spawnSync('python', ['-c', 'import sys;print(sys.executable)'], {
  encoding: 'utf8'
}).stdout?.trim()
assert.ok(python, 'Python is required for worker lifecycle tests')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-mix-stems-'))
const worker = path.join(temp, 'worker.py')
await fs.writeFile(
  worker,
  `import sys,json,time,pathlib
cache=pathlib.Path(sys.argv[sys.argv.index('--cache')+1]);cache.mkdir(parents=True,exist_ok=True)
for line in sys.stdin:
 r=json.loads(line);time.sleep(1.2 if r['sourcePath']=='slow' else 0.01)
 a=cache/(str(r['id'])+'-out.wav');b=cache/(str(r['id'])+'-in.wav');a.write_bytes(b'fixture');b.write_bytes(b'fixture')
 print(json.dumps({'id':r['id'],'ok':True,'outVocals':str(a),'inVocals':str(b),'cueStartFrame':r['inStartFrame']+10,'outStartFrame':r['outStartFrame']+20,'seconds':0.01}),flush=True)
`
)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(test) {
  const deadline = Date.now() + 5000
  while (!test()) {
    assert.ok(Date.now() < deadline, 'Worker test timed out')
    await delay(20)
  }
}
const request = (revision, sourcePath = 'fast') => ({
  revision,
  sourcePath,
  nextPath: 'next',
  sampleRate: 44100,
  channels: 2,
  outStartFrame: 0,
  inStartFrame: 0,
  fadeFrames: 44100
})
const calls = [],
  commits = [],
  statuses = []
const service = new AutoMixStemService({
  python,
  worker,
  cache: temp,
  onReady: (r, out, inc, cue, start) => {
    calls.push(r.revision)
    commits.push({ cue, start })
  },
  onStatus: (s) => statuses.push(s)
})
try {
  service.request(request(1, 'slow'))
  await until(() => statuses.some((s) => s.startsWith('Preparing')))
  service.request(request(2))
  await until(() => calls.length > 0)
  assert.deepEqual(calls, [2], 'Stale active result must not be committed')
  assert.deepEqual(
    commits,
    [{ cue: 10, start: 20 }],
    'Both source positions must reach native commit'
  )
  service.request(request(3, 'slow'))
  await delay(900)
  service.cancel()
  await delay(500)
  assert.deepEqual(calls, [2], 'Cancelled work must not be committed')
} finally {
  service.close()
}
const timed = [],
  results = []
const timeout = new AutoMixStemService({
  python,
  worker,
  cache: temp,
  timeoutMs: 500,
  onReady: (r) => results.push(r),
  onStatus: (s) => timed.push(s)
})
try {
  timeout.request(request(4, 'slow'))
  await until(() => timed.some((s) => s.includes('timed out')))
  assert.equal(results.length, 0)
  timeout.request(request(5))
  await until(() => results.length === 1)
  assert.equal(results[0].revision, 5, 'Worker must restart after timeout')
} finally {
  timeout.close()
}
await delay(100)
assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep))
assert.ok(path.basename(temp).startsWith('auto-mix-stems-'))
await fs.rm(temp, { recursive: true, force: true })
console.log('Auto Mix stem service: stale queue, cancellation, timeout and restart passed')
