import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { nativeTheme } from 'electron'
import { t } from '../i18n'
import { Logger } from './loggerService'

export type TaskbarAction = 'previous' | 'toggle' | 'next'
interface PlaybackState {
  title?: string
  artist?: string
  album?: string
  isPlaying: boolean
  hasTrack: boolean
}
interface Options {
  platform: NodeJS.Platform
  command: string
  onAction: (action: TaskbarAction) => void
}

/** Owns only our taskbar strip process; playback stays in the existing player. */
export function createTaskbarPlaybackControls(options: Options): {
  state(): { available: boolean; enabled: boolean }
  setEnabled(enabled: boolean): void
  update(next?: PlaybackState): void
  dispose(): void
} {
  let child: ChildProcessWithoutNullStreams | undefined
  let state: PlaybackState = { isPlaying: false, hasTrack: false }
  let enabled = false
  let disposed = false
  let retries = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  const available = (): boolean => options.platform === 'win32' && existsSync(options.command)
  function stop(): void {
    clearTimeout(retry)
    retry = undefined
    const previous = child
    child = undefined
    previous?.stdin.end()
    previous?.kill()
  }
  function start(): void {
    if (!enabled || disposed || child || !available()) return
    const process = spawn(options.command, [], { windowsHide: true, stdio: 'pipe' })
    child = process
    const lines = createInterface({ input: process.stdout })
    lines.on('line', (line) => {
      if (child !== process || !enabled || !state.hasTrack) return
      if (line === 'previous' || line === 'toggle' || line === 'next') options.onAction(line)
    })
    process.stdin.on('error', () => {
      // Exit/error below handles a pipe closed during shutdown or a helper crash.
    })
    process.stderr.on('data', (data: Buffer) =>
      Logger.warn('[Taskbar] Strip diagnostic', data.toString().slice(0, 2000))
    )
    process.once('error', (error) => Logger.warn('[Taskbar] Strip process failed', error))
    process.once('close', () => {
      lines.close()
      if (child !== process) return
      child = undefined
      if (enabled && !disposed && retries++ < 3) {
        retry = setTimeout(start, 1000)
        retry.unref()
      }
    })
    update()
  }
  function update(next?: PlaybackState): void {
    if (next) state = { ...next }
    if (!child || !enabled || disposed || child.stdin.destroyed) return
    const labels = [t('trayPrevious'), t('trayPlay'), t('trayPause'), t('trayNext')]
    const information = state.hasTrack
      ? [state.title || t('trayUnknownTrack'), state.artist || '', state.album || '']
      : [t('trayNoTrack'), '', '']
    const encode = (value: string): string =>
      Buffer.from(
        Array.from(value.replace(/[\r\n\t]/g, ' '))
          .slice(0, 512)
          .join(''),
        'utf8'
      ).toString('hex') || '-'
    child.stdin.write(
      [
        'S',
        Number(state.isPlaying),
        Number(state.hasTrack),
        Number(nativeTheme.shouldUseDarkColors),
        ...[...labels, ...information].map(encode)
      ].join('|') + '\n'
    )
  }
  const themeChanged = (): void => update()
  if (options.platform === 'win32') nativeTheme.on('updated', themeChanged)
  return {
    state: () => ({ available: available(), enabled }),
    setEnabled(value) {
      if (disposed) return
      if (value && !available()) throw new Error(t('taskbarControlsUnavailable'))
      enabled = value
      retries = 0
      if (enabled) start()
      else stop()
    },
    update,
    dispose() {
      disposed = true
      enabled = false
      nativeTheme.off('updated', themeChanged)
      stop()
    }
  }
}
