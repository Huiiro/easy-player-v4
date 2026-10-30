import { parentPort, workerData } from 'node:worker_threads'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'

export function extractRuntimeArchive(archive: string, target: string, maxBytes: number): void {
  const zip = new AdmZip(archive)
  const entries = zip.getEntries()
  if (entries.length > 30_000) throw new Error('Too many component archive entries')
  let total = 0
  const names = new Set<string>()
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/')
    const parts = name.replace(/\/$/, '').split('/')
    if (
      !name ||
      parts.some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[<>:"|?*]/.test(p) ||
          [...p].some((character) => character.charCodeAt(0) < 32) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)
      ) ||
      !['python', 'models', 'component.json'].includes(parts[0]) ||
      ((entry.header.attr >>> 16) & 0o170000) === 0o120000 ||
      names.has(name.toLowerCase())
    )
      throw new Error('Unsafe component archive path')
    names.add(name.toLowerCase())
    total += entry.header.size
    if (total > maxBytes) throw new Error('Component archive exceeds extracted size budget')
  }
  for (const entry of entries) {
    const destination = path.join(target, entry.entryName.replace(/\\/g, '/'))
    if (entry.isDirectory) {
      mkdirSync(destination, { recursive: true })
      continue
    }
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, entry.getData(), { flag: 'wx' })
  }
}

if (parentPort && workerData) {
  try {
    extractRuntimeArchive(workerData.archive, workerData.target, workerData.maxBytes)
    parentPort.postMessage({ ok: true })
  } catch (error) {
    parentPort.postMessage({ error: String(error) })
  }
  parentPort.close()
}
