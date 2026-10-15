import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { LyricFormat, LyricLoadPayload } from './types'

export function readLocalLyrics(audioPath: string): LyricLoadPayload | null {
  const directory = dirname(audioPath)
  const stem = basename(audioPath, extname(audioPath))
  const formats: LyricFormat[] = ['elrc', 'yrc', 'krc', 'ttml', 'lrc']
  for (const name of [stem, 'lyrics']) {
    for (const format of formats) {
      const path = join(directory, `${name}.${format}`)
      if (existsSync(path)) return { content: readFileSync(path, 'utf8'), format, path }
    }
  }
  return null
}
