import { basename, extname } from 'node:path'
import type { RemoteTrack } from './remoteProvider'

const AUDIO = new Set([
  'mp3',
  'flac',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'aiff',
  'aif',
  'ape',
  'wma',
  'dsf',
  'dff',
  'alac'
])
export const MAX_NAS_ENTRIES = 100_000
export function nasTrack(path: string, size: number): RemoteTrack | undefined {
  const format = extname(path).slice(1).toLowerCase()
  if (!AUDIO.has(format)) return undefined
  return { id: path, title: basename(path, extname(path)), path, format, size }
}
