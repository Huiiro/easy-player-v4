import { app, net } from 'electron'
import { Worker } from 'node:worker_threads'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { AutoMixRuntimeService, autoMixReleaseUrl } from './autoMixRuntimeService'
import {
  getMainPath,
  getStemCachePath,
  getStemRuntimeRoot,
  getStemWorkerPath
} from '../utils/pathUtils'
import type { AutoMixRuntimeStatus } from '../../shared/autoMixRuntime'

export function createAutoMixRuntimeManager(
  onChange: (status: AutoMixRuntimeStatus) => void,
  beforeMaintenance?: () => Promise<void>
): AutoMixRuntimeService {
  const service = new AutoMixRuntimeService({
    root: getStemRuntimeRoot(),
    releaseBaseUrl: autoMixReleaseUrl(app.getVersion()),
    cacheDirectory: getStemCachePath(),
    beforeMaintenance,
    fetch: (url, signal) => net.fetch(url, { signal }),
    onChange,
    extract: (archive, target, maxBytes, signal) =>
      new Promise<void>((resolve, reject) => {
        const worker = new Worker(getMainPath('autoMixRuntimeWorker.js'), {
          workerData: { archive, target, maxBytes }
        })
        let failure: Error | undefined
        let completed = false
        const abort = (): void => {
          void worker.terminate()
        }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        worker.on('message', (message) => {
          if (message.ok === true) completed = true
          if (!message.ok) failure = new Error(message.error)
        })
        worker.on('error', (error) => {
          failure = error
        })
        worker.on('exit', (code) => {
          signal.removeEventListener('abort', abort)
          if (signal.aborted || failure || code !== 0 || !completed)
            reject(failure ?? new Error('Component extraction cancelled or failed'))
          else resolve()
        })
      }),
    verify: (directory, signal) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          path.join(directory, 'python/python.exe'),
          [
            '-I',
            '-B',
            '-X',
            'utf8',
            getStemWorkerPath(app.isPackaged),
            '--cache',
            getStemCachePath(),
            '--model-repo',
            path.join(directory, 'models'),
            '--warmup'
          ],
          { windowsHide: true, signal, stdio: ['ignore', 'pipe', 'pipe'] }
        )
        let diagnostic = ''
        child.stderr.on('data', (data) => {
          diagnostic = (diagnostic + data.toString()).slice(-2000)
        })
        let failure: Error | undefined
        child.once('error', (error) => {
          failure = error
        })
        child.once('close', (code) =>
          code === 0 && !failure
            ? resolve()
            : reject(failure ?? new Error(diagnostic || 'Component inference verification failed'))
        )
      })
  })
  app.once('before-quit', () => service.cancel())
  return service
}
