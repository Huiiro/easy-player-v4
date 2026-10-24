import { decryptQrc } from 'qrc-decoder'
import { cleanNetworkLyric } from '../../../src/main/service/networkLyricNormalizer'

function decodeEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity: string) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match
      const code =
        entity[1].toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
  )
}

/** QQ's desktop API returns encrypted hex; the older API returns text or base64. */
export function decodeQQMusicLyric(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  const source = value.trim()
  let decoded = source
  if (source.length >= 16 && source.length % 16 === 0 && /^[\da-f]+$/i.test(source)) {
    try {
      decoded = decryptQrc(source)
    } catch {
      return ''
    }
  } else if (source.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(source)) {
    decoded = Buffer.from(source, 'base64').toString('utf8')
  }
  const content = decoded.match(/\bLyricContent=(["'])([\s\S]*?)\1/)?.[2] ?? decoded
  return decodeEntities(content)
}

/** QRC writes text before each absolute word time; YRC writes the time before the text. */
export function qrcToYrc(content: string): string {
  const converted = content
    .split(/\r?\n/)
    .map((line) => {
      const match = line.trim().match(/^(\[\d+,\d+\])(.*)$/)
      if (!match) return line
      const words = [...match[2].matchAll(/(.*?)\((\d+),(\d+)\)/g)]
      if (!words.some((word) => word[1].trim())) return line
      return match[1] + words.map((word) => `(${word[2]},${word[3]},0)${word[1]}`).join('')
    })
    .join('\n')
  if (!/^\[\d+,\d+\].*\(\d+,\d+,0\)/m.test(converted)) return ''
  return cleanNetworkLyric(converted, 'yrc')
}

export function normalizeQQMusicTrack(value: unknown): { content: string; format: 'lrc' | 'yrc' } {
  const decoded = decodeQQMusicLyric(value)
  const yrc = qrcToYrc(decoded)
  return yrc
    ? { content: yrc, format: 'yrc' }
    : { content: cleanNetworkLyric(decoded, 'lrc'), format: 'lrc' }
}
