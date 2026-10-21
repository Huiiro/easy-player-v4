/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { parseFile } from 'music-metadata'

const require = createRequire(import.meta.url)
const source = await fs.readFile('src/main/service/audioMetadataService.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true
  }
}).outputText
function load(parser, writer) {
  const exports = {}
  const mocks = {
    'music-metadata': { parseFile: parser },
    '../audioEngine': { writeNativeMetadata: writer },
    './loggerService': {
      Logger: {
        warn() {
          return undefined
        }
      }
    },
    './operationLogger': { logError: String }
  }
  vm.runInNewContext(compiled, { exports, Error, require: (name) => mocks[name] ?? require(name) })
  return exports.parseAudioFile
}

const directory = await fs.mkdtemp(path.resolve('build/audio-metadata-test-'))
try {
  const file = path.join(directory, '青花.m4a')
  const original = Buffer.from('original audio must remain unchanged')
  await fs.writeFile(file, original)
  const fragmentError = new Error(
    'Missing sampleDuration and no defaultSampleDuration in track fragment header'
  )
  const options = { duration: true, skipCovers: true }
  const expected = { format: { duration: 297.685 }, common: {} }
  let temporary
  let writes = 0
  const parse = load(
    async (candidate, actualOptions) => {
      assert.equal(actualOptions, options)
      if (candidate === file) throw fragmentError
      assert.equal(candidate, temporary)
      return expected
    },
    (candidate) => {
      temporary = candidate
      writes++
      assert.notEqual(candidate, file)
      return true
    }
  )
  assert.equal(await parse(file, options), expected)
  assert.deepEqual(await fs.readFile(file), original)
  await assert.rejects(fs.stat(path.dirname(temporary)), { code: 'ENOENT' })
  assert.equal(writes, 1)

  const normal = load(
    async () => expected,
    () => assert.fail('ordinary files need no remux')
  )
  assert.equal(await normal(file), expected)
  const unrelatedError = new Error('Unexpected end of file')
  const broken = load(
    async () => {
      throw unrelatedError
    },
    () => assert.fail('unrelated errors must propagate')
  )
  await assert.rejects(broken(file), (error) => error === unrelatedError)
  const wrongExtension = load(
    async () => {
      throw fragmentError
    },
    () => assert.fail('non-MP4 files need no remux')
  )
  await assert.rejects(
    wrongExtension(path.join(directory, 'audio.mp3')),
    (error) => error === fragmentError
  )
  assert.equal(writes, 1, 'non-MP4 files must not be remuxed')

  for (const failure of [false, new Error('native remux failure')]) {
    const failed = load(
      async () => {
        throw fragmentError
      },
      (candidate) => {
        temporary = candidate
        if (failure instanceof Error) throw failure
        return failure
      }
    )
    await assert.rejects(failed(file), (error) => error === fragmentError)
    await assert.rejects(fs.stat(path.dirname(temporary)), { code: 'ENOENT' })
    assert.deepEqual(await fs.readFile(file), original)
  }
  const retryFailure = load(
    async () => {
      throw fragmentError
    },
    (candidate) => {
      temporary = candidate
      return true
    }
  )
  await assert.rejects(retryFailure(file), (error) => error === fragmentError)
  await assert.rejects(fs.stat(path.dirname(temporary)), { code: 'ENOENT' })
  console.log(
    'Metadata fallback, options, error propagation, source preservation and cleanup passed'
  )

  // Optional regression against a real downloaded DASH file and the bundled decoder.
  if (process.argv[2]) {
    const sample = path.resolve(process.argv[2])
    const hash = async () =>
      createHash('sha256')
        .update(await fs.readFile(sample))
        .digest('hex')
    const before = await hash()
    await assert.rejects(parseFile(sample), /Missing sample(Duration|Size)/)
    const addon = require(path.resolve('build/native-addon/easy_player_native.node'))
    const actual = await load(parseFile, addon.writeMetadata)(sample, { duration: true })
    assert.ok(actual.format.duration > 0)
    assert.equal(await hash(), before)
    const engine = new addon.AudioEngine()
    try {
      assert.equal(engine.open(sample), true)
    } finally {
      engine.stop()
    }
    console.log(
      `Real DASH file parsed: ${actual.format.duration}s, ${actual.format.sampleRate}Hz; native open passed; SHA-256 unchanged`
    )
  }
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
