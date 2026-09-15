import { createOrbitTables } from './blackHoleGeodesics'

self.onmessage = (): void => {
  const tables = createOrbitTables()
  self.postMessage(tables, { transfer: [tables.paths.buffer, tables.ends.buffer] })
}
