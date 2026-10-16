import { parentPort } from 'node:worker_threads'
import { buildSearchTerms } from './japaneseReadings'
import type { SearchFields } from './searchTokens'

parentPort?.on('message', async (message: { requestId: number; fields: SearchFields }) => {
  try {
    parentPort?.postMessage({
      requestId: message.requestId,
      ...(await buildSearchTerms(message.fields))
    })
  } catch (error) {
    parentPort?.postMessage({ requestId: message.requestId, error: String(error) })
  }
})
