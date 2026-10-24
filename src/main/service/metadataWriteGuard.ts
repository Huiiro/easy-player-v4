import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { platform } from 'node:process'
import { t } from '../i18n'

export type MetadataPlaybackStatusProvider = () =>
  { trackInfo?: { filePath?: string } | null } | null | undefined

let playbackStatus: MetadataPlaybackStatusProvider = () => null

export function setMetadataPlaybackStatusProvider(provider: MetadataPlaybackStatusProvider): void {
  playbackStatus = provider
}

function canonicalPath(filePath: string): string {
  let result: string
  try {
    result = realpathSync.native(filePath)
  } catch {
    result = resolve(filePath)
  }
  return platform === 'win32' ? result.toLowerCase() : result
}

/** Pause/stop can retain the decoder handle; protect the loaded file until it is released. */
export function assertMetadataFileWritable(filePath: string): void {
  const current = playbackStatus()?.trackInfo?.filePath
  if (current && canonicalPath(current) === canonicalPath(filePath))
    throw new Error(t('metadataPlaybackSkipped'))
}
