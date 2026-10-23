/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { parseFile } from 'music-metadata'

const require = createRequire(import.meta.url)
const addon = require(
  path.resolve(
    process.env.EASY_PLAYER_METADATA_ADDON || 'build/native-addon/easy_player_native.node'
  )
)
const directory = await fs.mkdtemp(path.resolve('build/native-metadata-test-'))
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex')
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.error?.message || result.stderr)
  return result.stdout.trim()
}
const audioHash = (file) =>
  ffmpeg(['-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-'])
const coverHashes = (metadata) =>
  metadata.common.picture?.map((picture) => digest(picture.data)) ?? []

async function checkUpdates(file) {
  const before = await parseFile(file, { duration: true })
  const audio = audioHash(file)
  const covers = coverHashes(before)
  assert.ok(covers.length, 'fixture must contain embedded artwork')
  for (const tags of [
    { genre: 'Electronic; Pop', artist: '测试歌手' },
    { title: '修改后的标题' },
    { genre: '' }
  ]) {
    assert.equal(addon.writeMetadata(file, tags), true)
    const after = await parseFile(file, { duration: true })
    if (tags.title) assert.equal(after.common.title, tags.title)
    if (tags.artist) assert.equal(after.common.artist, tags.artist)
    if (tags.genre) assert.equal(after.common.genre.join(', '), tags.genre)
    if (tags.genre === '') assert.equal(after.common.genre, undefined)
    assert.deepEqual(
      coverHashes(after),
      covers,
      'tag-only writes retain existing covers byte for byte'
    )
    assert.ok(Math.abs(after.format.duration - before.format.duration) < 0.05)
    assert.equal(audioHash(file), audio, 'tag writes must not change compressed audio')
  }
}

try {
  const jpeg = path.join(directory, '新封面.jpg')
  const png = path.join(directory, '原封面.png')
  await sharp({ create: { width: 48, height: 32, channels: 3, background: '#336699' } })
    .jpeg()
    .toFile(jpeg)
  await sharp({ create: { width: 32, height: 48, channels: 3, background: '#996633' } })
    .png()
    .toFile(png)
  for (const [extension, codec] of [
    ['m4a', 'aac'],
    ['flac', 'flac']
  ]) {
    for (const cover of [jpeg, png]) {
      const file = path.join(directory, `中文音频-${path.extname(cover).slice(1)}.${extension}`)
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100',
        '-i',
        cover,
        '-map',
        '0:a:0',
        '-map',
        '1:v:0',
        '-t',
        '0.3',
        '-c:a',
        codec,
        '-c:v',
        'copy',
        '-disposition:v:0',
        'attached_pic',
        '-metadata',
        'title=Original title',
        '-y',
        file
      ])
      await checkUpdates(file)
      const audio = audioHash(file)
      assert.equal(addon.writeMetadata(file, { coverPath: jpeg, genre: 'Rock' }), true)
      let metadata = await parseFile(file)
      assert.equal(metadata.common.genre[0], 'Rock')
      assert.deepEqual(coverHashes(metadata), [digest(await fs.readFile(jpeg))])
      assert.equal(audioHash(file), audio, 'cover replacement retains the complete audio stream')
      assert.equal(
        addon.writeMetadata(file, { genre: 'Jazz' }),
        true,
        'files with replacement covers remain editable'
      )
      metadata = await parseFile(file)
      assert.equal(metadata.common.genre[0], 'Jazz')
      assert.deepEqual(coverHashes(metadata), [digest(await fs.readFile(jpeg))])
      const intact = digest(await fs.readFile(file))
      assert.throws(() =>
        addon.writeMetadata(file, { coverPath: path.join(directory, 'missing.jpg') })
      )
      assert.equal(
        digest(await fs.readFile(file)),
        intact,
        'failed writes retain the original file'
      )
      assert.ok(
        !(await fs.readdir(directory)).some((name) => name.includes('.easy-player-meta-tmp'))
      )
    }
  }
  console.log(
    'Native metadata: JPEG/PNG cover preservation, repeated tag edits, cover replacement, compressed audio hashes and failure cleanup passed for M4A/FLAC'
  )
  if (process.argv[2]) {
    const source = path.resolve(process.argv[2])
    const original = digest(await fs.readFile(source))
    const copy = path.join(directory, path.basename(source))
    await fs.copyFile(source, copy)
    await checkUpdates(copy)
    assert.equal(
      digest(await fs.readFile(source)),
      original,
      'real source file must remain untouched'
    )
    console.log(
      'Real downloaded audio: tag edits retain cover/audio and source SHA-256 is unchanged'
    )
  }
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
