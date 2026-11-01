import { Worker } from 'node:worker_threads'
import { getMainPath } from '../utils/pathUtils'
import type { FingerprintItem, FingerprintScore } from './audioFingerprintMatching'

export class FingerprintComparisonWorker {
  private worker: Worker
  private pending = new Map<
    number,
    { resolve: (results: FingerprintScore[]) => void; reject: (error: unknown) => void }
  >()
  private requestId = 0
  private termination?: Promise<void>
  private closed = false
  private abort: () => void

  constructor(
    items: FingerprintItem[],
    private signal?: AbortSignal,
    workerPath = getMainPath('fingerprintMatchWorker.js')
  ) {
    signal?.throwIfAborted()
    const workerData = items.map((item) => ({
      id: item.id,
      data: Uint32Array.from(item.fingerprint.data)
    }))
    this.worker = new Worker(workerPath, {
      workerData,
      transferList: workerData.map((item) => item.data.buffer)
    })
    this.abort = (): void => {
      void this.close(signal?.reason)
    }
    signal?.addEventListener('abort', this.abort, { once: true })
    this.worker.on(
      'message',
      (message: { requestId: number; results: FingerprintScore[]; error?: string }) => {
        const request = this.pending.get(message.requestId)
        if (!request) return
        this.pending.delete(message.requestId)
        if (message.error) request.reject(new Error(message.error))
        else request.resolve(message.results)
      }
    )
    this.worker.on('error', (error) => {
      void this.close(error)
    })
    this.worker.on('exit', (code) => {
      if (!this.closed) void this.close(new Error(`Fingerprint worker exited: ${code}`))
    })
  }

  compare(pairs: Array<[number, number]>): Promise<FingerprintScore[]> {
    this.signal?.throwIfAborted()
    if (this.closed) return Promise.reject(new Error('Fingerprint worker is closed'))
    const requestId = ++this.requestId
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      try {
        this.worker.postMessage({ requestId, pairs })
      } catch (error) {
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  close(error: unknown = new Error('Fingerprint worker is closed')): Promise<void> {
    if (this.termination) return this.termination
    this.closed = true
    this.signal?.removeEventListener('abort', this.abort)
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
    this.termination = this.worker.terminate().then(
      () => undefined,
      () => undefined
    )
    return this.termination
  }
}
