/* eslint-disable @typescript-eslint/explicit-function-return-type -- Synthetic audio fixtures. */
import fs from 'node:fs/promises'
import path from 'node:path'

// DSD64 stereo silence. Tests decode PCM without opening any output device.
export async function createDsdFixtures(directory) {
  const data = Buffer.alloc(32768, 0x69)
  const dsf = Buffer.alloc(92 + data.length)
  dsf.write('DSD ')
  dsf.writeBigUInt64LE(28n, 4)
  dsf.writeBigUInt64LE(BigInt(dsf.length), 12)
  dsf.write('fmt ', 28)
  dsf.writeBigUInt64LE(52n, 32)
  dsf.writeUInt32LE(1, 40)
  dsf.writeUInt32LE(2, 48)
  dsf.writeUInt32LE(2, 52)
  dsf.writeUInt32LE(2822400, 56)
  dsf.writeUInt32LE(1, 60)
  dsf.writeBigUInt64LE(BigInt((data.length / 2) * 8), 64)
  dsf.writeUInt32LE(4096, 72)
  dsf.write('data', 80)
  dsf.writeBigUInt64LE(BigInt(data.length + 12), 84)
  data.copy(dsf, 92)
  const chunk = (name, body) => {
    const buffer = Buffer.alloc(12 + body.length + (body.length % 2))
    buffer.write(name)
    buffer.writeBigUInt64BE(BigInt(body.length), 4)
    body.copy(buffer, 12)
    return buffer
  }
  const rate = Buffer.alloc(4)
  rate.writeUInt32BE(2822400)
  const channels = Buffer.alloc(10)
  channels.writeUInt16BE(2)
  channels.write('SLFTSRGT', 2)
  const props = Buffer.concat([
    Buffer.from('SND '),
    chunk('FS  ', rate),
    chunk('CHNL', channels),
    chunk('CMPR', Buffer.from('DSD '))
  ])
  const dff = chunk(
    'FRM8',
    Buffer.concat([
      Buffer.from('DSD '),
      chunk('FVER', Buffer.from([1, 5, 0, 0])),
      chunk('PROP', props),
      chunk('DSD ', data)
    ])
  )
  const files = [path.join(directory, 'silence.dsf'), path.join(directory, 'silence.dff')]
  await Promise.all([fs.writeFile(files[0], dsf), fs.writeFile(files[1], dff)])
  return files
}
