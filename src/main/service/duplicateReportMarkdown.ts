import type { DuplicateFileReport } from '../../shared/duplicateFiles'
import {
  fingerprintFailureLabel,
  fingerprintWarningLabel
} from '../../shared/duplicateFingerprintErrors'

/** Localize authored report text; preserve original song metadata and tool diagnostics. */
export function duplicateReportMarkdown(
  report: DuplicateFileReport,
  language: 'zh' | 'en' = 'zh'
): string {
  const tr = (zh: string, en: string): string => (language === 'en' ? en : zh)
  const cell = (value: unknown): string =>
    String(value ?? '')
      .replace(/\|/g, '\\|')
      .replace(/[\r\n]/g, ' ')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  const field = (zh: string, en: string, value: unknown): string => `${tr(zh, en)}: ${cell(value)}`
  const lines = [
    `# Easy Player · ${tr('重复文件比对报告', 'Duplicate file comparison report')}`,
    '',
    field('生成时间', 'Created', report.createdAt),
    field('检查本地歌曲', 'Scanned local songs', report.scanned),
    field('已校验 SHA-256', 'SHA-256 checked', report.hashed),
    field(
      '检测模式',
      'Mode',
      report.mode === 'deep' ? tr('深度检测', 'Deep') : tr('快速检测', 'Quick')
    ),
    field('指纹分析长度（秒）', 'Fingerprint sample (s)', report.sampleSeconds),
    field('指纹并发上限', 'Fingerprint concurrency', report.concurrency),
    field('重复组数', 'Duplicate groups', report.groups.length),
    field('完全相同组数', 'Exact groups', report.exactGroups),
    field('疑似同曲组数', 'Similar groups', report.similarGroups),
    field('音频相似组数', 'Audio match groups', report.audioGroups),
    field('有效音频指纹', 'Audio fingerprints', report.fingerprinted),
    field('候选清理项', 'Cleanup candidates', report.extraFiles),
    field(
      '候选字节数（假定保留最大文件）',
      'Candidate bytes (keeping the largest file)',
      report.extraBytes
    ),
    '',
    tr(
      `完全相同按完整 SHA-256 确认；疑似同曲按歌曲信息筛选；音频相似按最多前 ${report.sampleSeconds} 秒指纹比对。相似结果需人工确认，不代表整首或音质相同。检测不会修改曲库或文件。`,
      `Exact groups share full SHA-256 hashes. Similar song candidates share normalized metadata and nearby durations. Audio matches compare up to the first ${report.sampleSeconds} seconds. Similar results require manual review and do not prove identical full recordings or quality. Detection is read-only.`
    ),
    ''
  ]
  const table = (headers: string[], rows: unknown[][]): void => {
    lines.push(
      `| ${headers.map(cell).join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`
    )
    for (const row of rows) lines.push(`| ${row.map(cell).join(' | ')} |`)
    lines.push('')
  }
  if (report.timings) {
    lines.push(`## ${tr('本次阶段耗时', 'Current scan timings')}`, '')
    table(
      [tr('阶段', 'Stage'), tr('耗时（毫秒）', 'Elapsed (ms)')],
      [
        [tr('检查文件', 'File checking'), report.timings.checkingMs],
        ['SHA-256', report.timings.hashingMs],
        [tr('提取指纹', 'Fingerprint extraction'), report.timings.fingerprintMs],
        [tr('匹配', 'Matching'), report.timings.matchingMs],
        [tr('总计', 'Total'), report.timings.totalMs]
      ]
    )
  }
  if (report.matchingStats)
    lines.push(
      field('候选对数', 'Candidate pairs', report.matchingStats.candidatePairs),
      field('新计算对数', 'New comparisons', report.matchingStats.comparisons),
      field('复用对数', 'Reused comparisons', report.matchingStats.reusedPairs),
      ''
    )
  if (report.cacheHits)
    lines.push(
      field('SHA-256 缓存命中', 'SHA-256 cache hits', report.cacheHits.sha256),
      field('指纹缓存命中', 'Fingerprint cache hits', report.cacheHits.fingerprint),
      field('匹配缓存命中', 'Match cache hits', report.cacheHits.matches),
      field('报告缓存命中', 'Report cache hits', report.cacheHits.report),
      ''
    )
  if (report.checkingStats?.slowFiles.length) {
    lines.push(`## ${tr('文件状态检查耗时较长', 'Slow file state checks')}`, '')
    table(
      [tr('路径', 'Path'), tr('耗时（毫秒）', 'Elapsed (ms)')],
      report.checkingStats.slowFiles.map((file) => [file.path, file.elapsedMs])
    )
  }
  for (const [index, group] of report.groups.entries()) {
    lines.push(
      `## ${tr('重复组', 'Group')} ${index + 1}`,
      '',
      field(
        '比对类型',
        'Match',
        group.kind === 'exact'
          ? tr('完全相同', 'Exact')
          : group.kind === 'audio'
            ? tr('音频相似，需人工确认', 'Audio match, review required')
            : tr('疑似同曲，需人工确认', 'Similar, review required')
      ),
      field('时长差（秒）', 'Duration spread (s)', group.durationSpread)
    )
    if (group.hash) lines.push(`SHA-256: ${group.hash}`)
    if (group.audioMatch)
      lines.push(
        field(
          '指纹相似度',
          'Fingerprint similarity',
          `${(group.audioMatch.score * 100).toFixed(1)}%`
        ),
        field(
          '分析片段覆盖',
          'Analyzed segment coverage',
          `${(group.audioMatch.coverage * 100).toFixed(1)}%`
        ),
        field('对齐偏移（秒）', 'Alignment offset (s)', group.audioMatch.offsetSeconds)
      )
    lines.push('')
    table(
      [
        tr('歌曲编号', 'Song ID'),
        tr('标题', 'Title'),
        tr('歌手', 'Artist'),
        tr('专辑', 'Album'),
        tr('时长（秒）', 'Duration (s)'),
        tr('大小（字节）', 'Size (bytes)'),
        tr('格式', 'Format'),
        tr('码率（千比特每秒）', 'Bitrate (kbps)'),
        tr('采样率（赫兹）', 'Sample rate (Hz)'),
        tr('位深', 'Bit depth'),
        tr('路径', 'Path'),
        'SHA-256'
      ],
      group.files.map((file) => [
        file.id,
        file.title,
        file.artist,
        file.album,
        file.duration,
        file.size,
        file.format,
        file.bitrate,
        file.sampleRate,
        file.bitDepth,
        file.audio,
        file.sha256
      ])
    )
  }
  if (report.skipped.length) {
    lines.push(`## ${tr('未参与比对', 'Skipped files')}`, '')
    table(
      [tr('路径', 'Path'), tr('原因', 'Reason')],
      report.skipped.map((file) => [
        file.path,
        file.reason === 'sidecar'
          ? tr('macOS 附属信息文件，非音频', 'macOS metadata sidecar, not audio')
          : file.reason === 'changed'
            ? tr('检测期间文件发生变化', 'File changed during analysis')
            : tr('文件无法读取或无效', 'Unreadable or invalid file')
      ])
    )
  }
  if (report.fingerprintWarnings?.length) {
    lines.push(`## ${tr('已保留的指纹警告', 'Warnings for retained fingerprints')}`, '')
    table(
      [tr('路径', 'Path'), tr('说明', 'Details'), tr('原始诊断', 'Raw diagnostics')],
      report.fingerprintWarnings.map((warning) => [
        warning.path,
        fingerprintWarningLabel(warning.reason, language),
        warning.stderr
      ])
    )
  }
  if (report.fingerprintSkipped.length) {
    lines.push(`## ${tr('无法提取指纹', 'Fingerprint unavailable')}`, '')
    const failures = new Map(report.fingerprintFailures?.map((file) => [file.path, file]))
    table(
      [
        tr('路径', 'Path'),
        tr('原因', 'Reason'),
        tr('退出码', 'Exit code'),
        tr('原始诊断', 'Raw diagnostics')
      ],
      report.fingerprintSkipped.map((file) => {
        const failure = failures.get(file)
        return [
          file,
          failure
            ? fingerprintFailureLabel(failure.reason, language)
            : tr(
                '旧报告未记录原因，请重新检测',
                'No detailed cause in this older report; run a new scan'
              ),
          failure?.exitCode,
          failure?.stderr || failure?.message
        ]
      })
    )
  }
  return lines.join('\n') + '\n'
}
