import { extname } from 'node:path'

export function verifyResource(bytes: Buffer, path: string): void {
  const extension = extname(path).toLowerCase()
  const hex = bytes.subarray(0, 12).toString('hex')
  const signature = bytes.subarray(0, 4).toString('ascii')
  const valid =
    extension === '.png'
      ? hex.startsWith('89504e470d0a1a0a')
      : ['.jpg', '.jpeg'].includes(extension)
        ? hex.startsWith('ffd8ff')
        : extension === '.webp'
          ? signature === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
          : extension === '.gif'
            ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())
            : extension === '.woff'
              ? signature === 'wOFF'
              : extension === '.woff2'
                ? signature === 'wOF2'
                : extension === '.otf'
                  ? signature === 'OTTO'
                  : extension === '.ttf'
                    ? hex.startsWith('00010000') || signature === 'true'
                    : false
  if (!valid) throw new Error(`Resource content does not match format: ${path}`)
}
