/* eslint @typescript-eslint/explicit-function-return-type: off */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import AdmZip from 'adm-zip'

const root = 'docs/themes/nyan-cat'
await mkdir(`${root}/images`, { recursive: true })
await mkdir(`${root}/artwork`, { recursive: true })
const rainbow = ['#ff809f', '#ffbd78', '#ffe58d', '#9de6b5', '#87cefa', '#c3a1ff']
const rect = (x, y, w, h, fill) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`
let cat = rainbow.map((color, index) => rect(0, 6 + index * 2, 17, 2, color)).join('')
cat +=
  rect(11, 4, 19, 15, '#382d47') + rect(12, 5, 17, 13, '#f1c58d') + rect(14, 6, 13, 11, '#ffadce')
cat += [
  [16, 8],
  [22, 7],
  [25, 10],
  [18, 12],
  [23, 14],
  [15, 15]
]
  .map(([x, y]) => rect(x, y, 1, 1, '#e66f9c'))
  .join('')
cat +=
  rect(13, 19, 6, 2, '#382d47') +
  rect(14, 18, 3, 2, '#b4acc5') +
  rect(24, 19, 6, 2, '#382d47') +
  rect(25, 18, 3, 2, '#b4acc5')
cat += rect(7, 12, 5, 2, '#382d47') + rect(6, 10, 2, 3, '#382d47') + rect(8, 12, 4, 1, '#b4acc5')
cat += rect(27, 8, 11, 11, '#382d47') + rect(28, 6, 3, 4, '#382d47') + rect(34, 6, 3, 4, '#382d47')
cat +=
  rect(28, 10, 9, 8, '#b4acc5') +
  rect(29, 8, 1, 3, '#b4acc5') +
  rect(35, 8, 1, 3, '#b4acc5') +
  rect(30, 9, 5, 2, '#b4acc5')
cat +=
  rect(30, 12, 1, 2, '#382d47') +
  rect(35, 12, 1, 2, '#382d47') +
  rect(28, 14, 2, 1, '#f59bbb') +
  rect(36, 14, 1, 1, '#f59bbb')
cat += rect(32, 14, 1, 1, '#382d47') + rect(31, 16, 4, 1, '#382d47')
const catSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24" viewBox="0 0 40 24" shape-rendering="crispEdges">${cat}</svg>`
const catPNG = await sharp(Buffer.from(catSVG))
  .resize(120, 72, { kernel: 'nearest' })
  .png()
  .toBuffer()
await writeFile(`${root}/artwork/nyan-cat.svg`, catSVG)
let stars = ''
for (let i = 0; i < 48; i++) {
  const x = (i * 193 + 73) % 1440,
    y = (i * 137 + 41) % 900
  const color = ['#d4c2f0', '#f5bbd9', '#b3dbed'][i % 3]
  stars += `<g opacity="${i % 3 === 0 ? 0.7 : 0.32}">${rect(x, y, 3, 11, color)}${rect(x - 4, y + 4, 11, 3, color)}</g>`
}
const skySVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="#221739"/><stop offset="1" stop-color="#10172c"/></linearGradient></defs><rect width="1440" height="900" fill="url(#sky)"/>${stars}</svg>`
const skyPNG = await sharp(Buffer.from(skySVG)).png().toBuffer()
const tokens = {
  '--color-primary': '#f3a7d3',
  '--color-primary-fill': '#f3a7d3',
  '--color-on-primary': '#302039',
  '--color-text': '#f8f1ff',
  '--color-text-l': '#c5b8dc',
  '--color-text-l2': '#a090bd',
  '--color-text-l3': '#77648f',
  '--color-bg': '#191329',
  '--color-bg-l': '#281f3d',
  '--color-bg-l2': '#34294c',
  '--color-bg-d': '#100d1f',
  '--color-border': '#67537d',
  '--color-border-l': '#997fab',
  '--color-hover': '#e8b7ff18',
  '--color-hover-bg': '#473353',
  '--color-icon': '#ead8f7',
  '--color-icon-l': '#bba5cd',
  '--color-danger': '#ff90ac',
  '--color-success': '#9de6b5',
  '--color-warning': '#ffe58d',
  '--btn-primary-bg': '#f3a7d3',
  '--btn-primary-text': '#302039',
  '--btn-primary-bg-hover': '#ffc8e4',
  '--btn-primary-ring': '#b3e7e3',
  '--btn-danger-bg': '#583349',
  '--btn-danger-text': '#ffccdf',
  '--btn-danger-bg-hover': '#704158',
  '--app-header-bg': '#21182fe8',
  '--app-footer-bg': '#2a203ceF',
  '--app-chrome-border': '#c298d647',
  '--ep-sidebar-bg': '#21182fc9',
  '--ep-sidebar-text': '#d9c9eb',
  '--ep-sidebar-active-bg': '#d5b6ff26',
  '--ep-sidebar-active-text': '#f7c6e8',
  '--ep-sidebar-item-radius': '14px',
  '--ep-button-radius': '999px',
  '--ep-dialog-bg': '#2b203d',
  '--ep-dialog-radius': '24px',
  '--ep-overlay-bg': '#100b24b8',
  '--ep-surface-shadow': '0 16px 60px #07051266, 0 0 0 1px #d4afe638',
  '--ep-progress-track': '#53415f',
  '--ep-progress-fill': '#f3a7d3',
  '--ep-progress-thumb': '#ffe4f1',
  '--ep-range-track-height': '8px',
  '--ep-range-thumb-width': '60px',
  '--ep-range-thumb-height': '36px',
  '--ep-range-thumb-radius': '0px',
  '--ep-range-thumb-bg': 'transparent',
  '--ep-range-fill-background': `linear-gradient(to bottom, ${rainbow.map((color, i) => `${color} ${(i * 100) / 6}% ${((i + 1) * 100) / 6}%`).join(', ')})`,
  '--ep-switch-active': '#c7b4f5',
  '--ep-switch-inactive': '#69547e',
  '--scrollbar-track': 'transparent',
  '--scrollbar-thumb': '#725a89',
  '--scrollbar-thumb-hover': '#c5a3df'
}
const theme = {
  version: 1,
  name: 'Nyan Cat · 彩虹糖星球',
  background: 'replace',
  tokens,
  rules: {
    '.ep-playback-progress': { height: '36px' },
    '.ep-sidebar-item--active': { 'box-shadow': 'inset 3px 0 0 #f3a7d3' },
    '.ep-button--primary': { 'box-shadow': '0 4px 16px #f3a7d324' },
    '.ep-dialog-title': { color: '#f7c6e8' },
    '.ep-dialog-header': { 'border-bottom': '1px solid #c298d633' },
    '.ep-dialog-footer': { 'border-top': '1px solid #c298d633' },
    '.ep-input': { 'border-radius': '10px' },
    '.ep-footer': { 'border-radius': '24px' }
  }
}
const manifest = {
  version: 1,
  id: 'nyan-cat',
  theme: 'theme.json',
  resources: {
    cute: { type: 'font', path: 'fonts/kuaile.ttf', weight: '400' },
    cat: { type: 'image', path: 'images/nyan-cat.png' },
    sky: { type: 'image', path: 'images/starfield.png' }
  },
  slots: {
    global: { font: 'cute' },
    appBackground: { image: 'sky' },
    playbackThumb: { image: 'cat' }
  },
  text: { appTitle: 'Nyan Player', homeWelcome: 'Nyan~ 今天也要开心听歌喵！' },
  licenses: ['fonts/OFL.txt']
}
const files = new Map([
  ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')],
  ['theme.json', Buffer.from(JSON.stringify(theme, null, 2) + '\n')],
  ['images/nyan-cat.png', catPNG],
  ['images/starfield.png', skyPNG],
  ['fonts/kuaile.ttf', await readFile(`${root}/fonts/kuaile.ttf`)],
  ['fonts/OFL.txt', await readFile(`${root}/fonts/OFL.txt`)]
])
const zip = new AdmZip()
for (const [file, bytes] of files) {
  await writeFile(`${root}/${file}`, bytes)
  zip.addFile(file, bytes)
}
await writeFile('docs/themes/nyan-cat.theme.zip', zip.toBuffer())
console.log('Created docs/themes/nyan-cat.theme.zip')
