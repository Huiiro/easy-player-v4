import { parentPort, workerData } from 'node:worker_threads'
import { comparePreparedFingerprints, prepareFingerprint } from './audioFingerprintMatching'

const prepared = new Map(
  (workerData as Array<{ id: number; data: Uint32Array }>).map((item) => [
    item.id,
    prepareFingerprint(item)
  ])
)
parentPort?.on('message', (message: { requestId: number; pairs: Array<[number, number]> }) => {
  try {
    const results = message.pairs.map(([a, b]) => {
      const first = prepared.get(a),
        second = prepared.get(b)
      if (!first || !second) throw new Error('Unknown fingerprint')
      return comparePreparedFingerprints(first, second)
    })
    parentPort?.postMessage({ requestId: message.requestId, results })
  } catch (error) {
    parentPort?.postMessage({ requestId: message.requestId, error: String(error) })
  }
})
