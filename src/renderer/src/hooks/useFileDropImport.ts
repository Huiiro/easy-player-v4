import { onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUIStore } from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'
import eventBus from '@/utils/eventBus'
import { importFileKind } from '../../../shared/audioFormats'

/** Capture external files before a nested sorting target or Chromium can consume the drop. */
export function useFileDropImport(): void {
  const ui = useUIStore()
  const { t } = useI18n()
  const { success, info, warning, error } = useMessage()
  let queue = Promise.resolve()
  let disposed = false
  const isFileDrop = (event: DragEvent): boolean =>
    !!event.dataTransfer &&
    (Array.from(event.dataTransfer.types).includes('Files') || event.dataTransfer.files.length > 0)

  async function importFiles(
    paths: string[],
    directories: Set<string>,
    unresolved: number
  ): Promise<void> {
    if (disposed) return
    const files = paths.filter((file) => !directories.has(file))
    const audio = files.filter((file) => importFileKind(file) === 'audio')
    const packages = files.filter((file) =>
      ['plugin', 'backup'].includes(importFileKind(file) || '')
    )
    let imported = 0
    let duplicates = 0
    let skipped = 0
    let failed = 0
    const unsupported = files.length - audio.length - packages.length
    const reasons = new Map<string, number>()
    function recordFailure(reason: unknown, count = 1): void {
      const message =
        reason && typeof reason === 'object' && 'message' in reason
          ? String(reason.message)
          : typeof reason === 'string'
            ? reason
            : ''
      const detail = message
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
        .trim()
      if (detail) reasons.set(detail, (reasons.get(detail) ?? 0) + count)
      else failed += count
    }
    function recordAudioImport(result: {
      added: number
      duplicates: number
      skipped: number
      total: number
    }): void {
      imported += result.added
      duplicates += result.duplicates
      skipped += result.skipped
      failed += Math.max(0, result.total - result.added - result.duplicates - result.skipped)
      if (result.added) eventBus.emit('scanFinished')
    }
    for (const directory of directories) {
      try {
        const response = await window.api.library.scanLocalMusicFolder(
          directory,
          ui.ignoreShortSongs
        )
        recordAudioImport(response.result)
      } catch (reason) {
        recordFailure(reason)
      }
    }
    if (audio.length) {
      try {
        const result = await window.api.library.importLocalMusicFiles(audio, ui.ignoreShortSongs)
        recordAudioImport(result)
      } catch (reason) {
        recordFailure(reason, audio.length)
      }
    }
    for (const file of packages) {
      try {
        const plugin = importFileKind(file) === 'plugin'
        const result = plugin
          ? await window.api.plugins.importPackage(file)
          : await window.api.files.importLibrary(file)
        if (result.cancelled) continue
        if (!result.success) {
          recordFailure(result.error)
          continue
        }
        imported++
        if (!plugin) {
          eventBus.emit('scanFinished')
          eventBus.emit('playlistsChanged')
          eventBus.emit('tagsChanged')
        }
      } catch (reason) {
        recordFailure(reason)
      }
    }
    const messages: string[] = []
    if (imported) messages.push(t('dropImport.success', { count: imported }))
    if (duplicates) messages.push(t('dropImport.duplicates', { count: duplicates }))
    if (skipped) messages.push(t('dropImport.shortAudio', { count: skipped }))
    if (unsupported) messages.push(t('dropImport.unsupported', { count: unsupported }))
    if (unresolved) messages.push(t('dropImport.unresolved', { count: unresolved }))
    if (failed) messages.push(t('dropImport.failed', { count: failed }))
    for (const [reason, count] of reasons)
      messages.push(t('dropImport.failedReason', { count, reason }))
    const message = messages.length
      ? messages.join(t('dropImport.separator'))
      : t('dropImport.empty')
    const hasFailures = failed || unsupported || unresolved || reasons.size
    if (hasFailures) {
      if (imported || duplicates || skipped) warning(message)
      else error(message)
    } else if (imported) success(message)
    else info(message)
  }

  function dragOver(event: DragEvent): void {
    if (!isFileDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  function drop(event: DragEvent): void {
    if (!isFileDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
    const paths = new Set<string>()
    const directories = new Set<string>()
    let unresolved = 0
    // Chromium exposes folder identity only during the drop event. Resolve it before queueing.
    for (const item of Array.from(event.dataTransfer!.items ?? [])) {
      if (item.kind !== 'file') continue
      try {
        if (!item.webkitGetAsEntry()?.isDirectory) continue
        const file = item.getAsFile()
        const path = file && window.api.audio.getFilePath(file)
        if (path) directories.add(path)
      } catch {
        // File path errors are reported while processing the FileList below.
      }
    }
    for (const file of Array.from(event.dataTransfer!.files)) {
      try {
        const path = window.api.audio.getFilePath(file)
        if (path) paths.add(path)
        else unresolved++
      } catch {
        unresolved++
      }
    }
    // Snapshot File paths synchronously; DataTransfer expires after the drop handler returns.
    queue = queue
      .then(() => importFiles([...paths], directories, unresolved))
      .catch(() => {
        error(t('dropImport.failed', { count: paths.size + unresolved || 1 }))
      })
  }
  onMounted(() => {
    document.addEventListener('dragover', dragOver, true)
    document.addEventListener('drop', drop, true)
  })
  onBeforeUnmount(() => {
    disposed = true
    document.removeEventListener('dragover', dragOver, true)
    document.removeEventListener('drop', drop, true)
  })
}
