import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { SystemMediaAction } from '../../shared/systemMediaControls'

/** Ordered commands target only the renderer active when the request arrived. */
export function createPlaybackCommandService(window: () => BrowserWindow | null): {
  execute(action: SystemMediaAction): Promise<boolean>
  dispose(): void
} {
  const pending = new Map<string, { sender: number; finish(success: boolean): void }>()
  let disposed = false
  let queue: Promise<unknown> = Promise.resolve()
  const onResult = (event: Electron.IpcMainEvent, result: unknown): void => {
    if (!result || typeof result !== 'object') return
    const { id, success } = result as { id?: string; success?: boolean }
    const request = typeof id === 'string' ? pending.get(id) : undefined
    if (request && event.sender.id === request.sender && event.sender === window()?.webContents)
      request.finish(success === true)
  }
  ipcMain.on('system:media-action-result', onResult)
  return {
    execute(action) {
      const target = window()
      const receivedAt = Date.now()
      const operation = queue.then(
        () =>
          new Promise<boolean>((resolve) => {
            if (
              disposed ||
              Date.now() - receivedAt > 2500 ||
              !target ||
              target !== window() ||
              target.isDestroyed() ||
              target.webContents.isLoadingMainFrame()
            ) {
              resolve(false)
              return
            }
            const id = randomUUID()
            const timer = setTimeout(() => finish(false), 2500)
            timer.unref()
            const finish = (success: boolean): void => {
              clearTimeout(timer)
              pending.delete(id)
              resolve(success)
            }
            pending.set(id, { sender: target.webContents.id, finish })
            try {
              target.webContents.send('system:media-action', { id, action })
            } catch {
              finish(false)
            }
          })
      )
      queue = operation.catch(() => {})
      return operation
    },
    dispose() {
      disposed = true
      ipcMain.removeListener('system:media-action-result', onResult)
      for (const request of pending.values()) request.finish(false)
    }
  }
}
