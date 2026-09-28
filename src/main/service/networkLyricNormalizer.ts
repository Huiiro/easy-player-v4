export type NetworkLyricFormat = 'lrc' | 'yrc' | 'krc'

function timestamp(ms: number): string {
  const value = Math.max(0, ms)
  return `${Math.floor(value / 60000)
    .toString()
    .padStart(2, '0')}:${((value % 60000) / 1000).toFixed(3).padStart(6, '0')}`
}

/** Keep only timed lyric rows; apply the offset before removing metadata tags. */
export function cleanNetworkLyric(content: string, format: NetworkLyricFormat): string {
  const source = content.replace(/^\uFEFF/, '')
  const offset = Number(source.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] ?? 0)
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      format === 'lrc' ? /^\[\d+:\d{1,2}(?:[.:]\d{1,3})?\]/.test(line) : /^\[\d+,\d+\]/.test(line)
    )
    .map((line) => {
      if (!offset) return line
      if (format === 'lrc')
        return line.replace(
          /\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g,
          (_, minutes, seconds) =>
            `[${timestamp(Number(minutes) * 60000 + Number(seconds.replace(':', '.')) * 1000 + offset)}]`
        )
      const shifted = line.replace(
        /^\[(\d+),(\d+)\]/,
        (_, start, duration) => `[${Math.max(0, Number(start) + offset)},${duration}]`
      )
      return format === 'yrc'
        ? shifted.replace(
            /\((\d+),(\d+),(\d+)\)/g,
            (_, start, duration, flag) =>
              `(${Math.max(0, Number(start) + offset)},${duration},${flag})`
          )
        : shifted
    })
    .join('\n')
}

/** KRC language metadata is decoded into standalone tracks before it is discarded. */
export function normalizeKrc(content: string): {
  lrc: string
  translation?: string
  translationFormat?: 'lrc'
  romanization?: string
  romanizationFormat?: 'yrc'
} {
  const lrc = cleanNetworkLyric(content, 'krc')
  const encoded = content.match(/^\s*\[language:([^\]]+)\]/m)?.[1]
  if (!encoded) return { lrc }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
      content?: Array<{ type?: number; lyricContent?: unknown[][] }>
    }
    const lines = lrc.split('\n').flatMap((line) => {
      const match = line.match(/^\[(\d+),(\d+)\](.*)$/)
      if (!match) return []
      const start = Number(match[1])
      const words = [...match[3].matchAll(/<(\d+),(\d+),\d+>([^<]*)/g)]
      return [{ start, duration: match[2], words }]
    })
    const translations: string[] = []
    const romanizations: string[] = []
    for (const language of payload.content ?? []) {
      if (!Array.isArray(language.lyricContent)) continue
      let romanIndex = 0
      for (const [index, line] of lines.entries()) {
        const isEmpty = !line.words.some((word) => word[3].trim())
        const row = language.lyricContent[language.type === 0 ? romanIndex : index]
        if (language.type === 0 && !isEmpty) romanIndex++
        if (!Array.isArray(row) || isEmpty) continue
        if (language.type === 1 && typeof row[0] === 'string' && row[0].trim())
          translations.push(`[${timestamp(line.start)}]${row[0]}`)
        if (
          language.type === 0 &&
          row.length === line.words.length &&
          row.every((word) => typeof word === 'string')
        )
          romanizations.push(
            `[${line.start},${line.duration}]${line.words.map((word, wordIndex) => `(${line.start + Number(word[1])},${word[2]},0)${row[wordIndex]}`).join('')}`
          )
      }
    }
    return {
      lrc,
      translation: translations.length ? translations.join('\n') : undefined,
      translationFormat: translations.length ? 'lrc' : undefined,
      romanization: romanizations.length ? romanizations.join('\n') : undefined,
      romanizationFormat: romanizations.length ? 'yrc' : undefined
    }
  } catch {
    return { lrc }
  }
}
