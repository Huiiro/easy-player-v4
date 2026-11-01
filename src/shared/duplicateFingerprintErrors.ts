export type FingerprintFailureReason =
  | 'timeout'
  | 'decodeFailed'
  | 'spawn'
  | 'invalidOutput'
  | 'insufficientAudio'
  | 'outputLimit'
  | 'changed'
  | 'unavailable'
  | 'unknown'
export interface FingerprintFailure {
  path: string
  reason: FingerprintFailureReason
  message?: string
  stderr?: string
  exitCode?: number | null
}
const labels: Record<FingerprintFailureReason, [string, string]> = {
  timeout: ['提取超时', 'Extraction timed out'],
  decodeFailed: ['音频解码或提取失败', 'Audio decoding or extraction failed'],
  spawn: ['无法启动指纹组件', 'Could not start fingerprint tool'],
  invalidOutput: ['指纹组件输出无效', 'Invalid fingerprint tool output'],
  insufficientAudio: ['有效音频片段不足', 'Insufficient usable audio'],
  outputLimit: ['指纹输出超出限制', 'Fingerprint output exceeded limit'],
  changed: ['检测期间文件发生变化', 'File changed during analysis'],
  unavailable: ['文件无法读取', 'File is unreadable'],
  unknown: ['提取失败，原因未知', 'Extraction failed for an unknown reason']
}
export function fingerprintFailureLabel(reason: FingerprintFailureReason, locale: string): string {
  return (labels[reason] ?? labels.unknown)[locale.startsWith('en') ? 1 : 0]
}

export interface FingerprintNotice {
  reason: 'decodeWarning' | 'compatibilityDecode'
  stderr?: string
  exitCode?: number | null
}
export interface FingerprintWarning extends FingerprintNotice {
  path: string
}
export function fingerprintWarningLabel(
  reason: FingerprintNotice['reason'],
  locale: string
): string {
  const en = locale.startsWith('en')
  return reason === 'decodeWarning'
    ? en
      ? 'Usable fingerprint retained despite a decoding warning; review the analyzed segment.'
      : '解码存在警告，已保留有效指纹；请核对分析片段。'
    : en
      ? 'Fingerprint extracted using the compatibility decoder.'
      : '已通过兼容解码提取指纹。'
}
