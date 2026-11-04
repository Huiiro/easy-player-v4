/** Library selection, scanning, file association and external file drops share this list. */
export const SUPPORTED_AUDIO_EXTENSIONS = [
  '.mp3',
  '.aac',
  '.m4a',
  '.ogg',
  '.opus',
  '.flac',
  '.wav',
  '.aiff',
  '.ape',
  '.dff',
  '.dsf'
]

export function importFileKind(filename: string): 'audio' | 'plugin' | 'backup' | null {
  const extension = filename.match(/\.[^./\\]+$/)?.[0].toLowerCase()
  if (extension === '.epp') return 'plugin'
  if (extension === '.epb') return 'backup'
  return extension && SUPPORTED_AUDIO_EXTENSIONS.includes(extension) ? 'audio' : null
}
