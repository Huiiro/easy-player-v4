const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

const archive = path.resolve(process.argv[2] || 'dist/win-unpacked/resources/app.asar')
const entries = asar.listPackage(archive).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''))
const forbidden = entries.filter((entry) => entry === 'vcpkg' || entry.startsWith('vcpkg/'))
console.log(`app.asar size: ${(fs.statSync(archive).size / 1024 ** 2).toFixed(1)} MiB`)
console.log(`app.asar roots: ${[...new Set(entries.map((entry) => entry.split('/')[0]))].join(', ')}`)
if (forbidden.length) {
  throw new Error(`Build-only vcpkg files were packaged: ${forbidden.slice(0, 10).join(', ')}`)
}
if (!entries.includes('out/main/index.js')) {
  throw new Error('Packaged application entry point is missing')
}
console.log('Windows package content check passed')
