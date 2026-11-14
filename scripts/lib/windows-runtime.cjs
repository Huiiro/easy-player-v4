/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Windows build helper. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const isVCRuntime = (name) => /^(?:vcruntime|msvcp|msvcr|concrt|vccorlib)\d[\w.]*\.dll$/i.test(name)
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function peInfo(file) {
  const data = fs.readFileSync(file)
  if (data.length < 64 || data.toString('ascii', 0, 2) !== 'MZ')
    throw new Error(`Not a PE file: ${file}`)
  const pe = data.readUInt32LE(60)
  if (pe + 24 > data.length || data.toString('ascii', pe, pe + 4) !== 'PE\0\0')
    throw new Error(`Invalid PE header: ${file}`)
  const optional = pe + 24
  const magic = data.readUInt16LE(optional)
  if (![0x10b, 0x20b].includes(magic)) throw new Error(`Unsupported PE format: ${file}`)
  const sections = pe + 24 + data.readUInt16LE(pe + 20)
  const rvaOffset = (rva) => {
    if (rva === 0) return 0
    for (let index = 0; index < data.readUInt16LE(pe + 6); index++) {
      const offset = sections + index * 40
      const start = data.readUInt32LE(offset + 12)
      const size = Math.max(data.readUInt32LE(offset + 8), data.readUInt32LE(offset + 16))
      if (rva >= start && rva < start + size) {
        const result = data.readUInt32LE(offset + 20) + rva - start
        if (result >= data.length) throw new Error(`Invalid PE RVA: ${file}`)
        return result
      }
    }
    throw new Error(`Unmapped PE RVA: ${file}`)
  }
  const nameAt = (rva) => {
    const offset = rvaOffset(rva)
    const end = data.indexOf(0, offset)
    if (end < offset || end - offset > 255) throw new Error(`Invalid PE import name: ${file}`)
    const name = data.toString('ascii', offset, end)
    if (!/^[\w.+-]+\.dll$/i.test(name)) return null
    return name
  }
  const directory = optional + (magic === 0x20b ? 112 : 96)
  const imports = []
  const importRva = data.readUInt32LE(directory + 8)
  if (importRva) {
    for (let offset = rvaOffset(importRva); offset + 20 <= data.length; offset += 20) {
      const nameRva = data.readUInt32LE(offset + 12)
      if (!nameRva) break
      const name = nameAt(nameRva)
      if (name) imports.push(name)
    }
  }
  const delayRva = data.readUInt32LE(directory + 13 * 8)
  if (delayRva) {
    for (let offset = rvaOffset(delayRva); offset + 32 <= data.length; offset += 32) {
      const address = data.readUInt32LE(offset + 4)
      if (!address) break
      const imageBase =
        magic === 0x20b
          ? Number(data.readBigUInt64LE(optional + 24))
          : data.readUInt32LE(optional + 28)
      const name = nameAt(data.readUInt32LE(offset) & 1 ? address : address - imageBase)
      if (name) imports.push(name)
    }
  }
  return { machine: data.readUInt16LE(pe + 4), imports: [...new Set(imports)] }
}

function verifyWindowsRuntime(directory, executableDirectory = directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'msvc-runtime.json'), 'utf8'))
  if (
    manifest.formatVersion !== 1 ||
    manifest.arch !== 'x64' ||
    !manifest.dlls ||
    !Object.keys(manifest.dlls).length
  )
    throw new Error('Invalid VC++ runtime manifest')
  const files = fs.readdirSync(directory).filter((name) => /\.(?:dll|node|exe)$/i.test(name))
  const provided = new Set(Object.keys(manifest.dlls).map((name) => name.toLowerCase()))
  for (const name of Object.keys(manifest.dlls)) {
    if (!isVCRuntime(name)) throw new Error(`Unexpected VC++ runtime file: ${name}`)
    for (const base of new Set([directory, executableDirectory])) {
      const file = path.join(base, name)
      if (
        !fs.existsSync(file) ||
        digest(file) !== manifest.dlls[name] ||
        peInfo(file).machine !== 0x8664
      )
        throw new Error(`VC++ runtime missing, mismatched or wrong architecture: ${file}`)
    }
  }
  for (const name of files) {
    for (const dependency of peInfo(path.join(directory, name)).imports) {
      if (isVCRuntime(dependency) && !provided.has(dependency.toLowerCase()))
        throw new Error(`Unbundled VC++ dependency: ${name} -> ${dependency}`)
    }
  }
  return manifest
}

module.exports = { peInfo, isVCRuntime, digest, verifyWindowsRuntime }
