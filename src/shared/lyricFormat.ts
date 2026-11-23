import type { LyricFormat } from './networkSources'

export const LRC_TIME_TAG = /\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
export const ELRC_WORD_TAG = /<(\d+):(\d{1,2}(?:[.:]\d{1,3})?)>([^<]*)/g
const lrcTimestamp = new RegExp(LRC_TIME_TAG.source)
const elrcTimestamp = new RegExp(ELRC_WORD_TAG.source)

export function detectLyricFormat(content: string): LyricFormat {
  const source = content.replace(/^\uFEFF/, '').trim()
  if (/<tt(?:\s|>)/i.test(source)) return 'ttml'
  if (/^\s*\[\d+,\d+\].*<\d+,\d+,\d+>/m.test(source)) return 'krc'
  if (
    /^\s*\[\d+,\d+\]\s*\(\d+,\d+,\d+\)/m.test(source) ||
    /^\s*\[\d+,\d+\](?:\s*\(\d+,\d+\))+\s*$/m.test(source)
  )
    return 'yrc'
  if (elrcTimestamp.test(source)) return 'elrc'
  if (lrcTimestamp.test(source)) return 'lrc'
  return 'plain'
}
