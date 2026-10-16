/* eslint @typescript-eslint/explicit-function-return-type: off */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import AdmZip from 'adm-zip'

const root = 'docs/themes/resource-demo'
await mkdir(`${root}/images`, { recursive: true })
const width = 960
const height = 600
const pixels = Buffer.alloc(width * height * 3)
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const glow = Math.exp(
      -((x - width * 0.8) ** 2 + (y - height * 0.2) ** 2) / (width * height * 0.18)
    )
    const wave = Math.max(0, 1 - Math.abs(y - height * 0.65 - Math.sin(x / 160) * 60) / 100)
    const index = (y * width + x) * 3
    pixels[index] = Math.round(16 + glow * 30 + wave * 4)
    pixels[index + 1] = Math.round(15 + glow * 12 + wave * 18)
    pixels[index + 2] = Math.round(31 + glow * 48 + wave * 20)
  }
}
const background = await sharp(pixels, { raw: { width, height, channels: 3 } })
  .png()
  .toBuffer()
const manifest = {
  version: 1,
  id: 'resource-demo',
  theme: 'theme.json',
  resources: { nebula: { type: 'image', path: 'images/nebula.png' } },
  slots: { appBackground: { image: 'nebula' }, sidebar: { image: 'nebula' } },
  text: { appTitle: 'Easy Player · 星海', homeWelcome: '星海资源主题包已加载，开始听歌吧' }
}
const theme = JSON.parse(await readFile('docs/themes/neon-test.theme.json', 'utf8'))
theme.name = '星海 · 图片与文字资源测试'
const files = new Map([
  ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')],
  ['theme.json', Buffer.from(JSON.stringify(theme, null, 2) + '\n')],
  ['images/nebula.png', background]
])
const zip = new AdmZip()
for (const [file, bytes] of files) {
  await writeFile(`${root}/${file}`, bytes)
  zip.addFile(file, bytes)
}
await writeFile('docs/themes/resource-demo.theme.zip', zip.toBuffer())
console.log('Created docs/themes/resource-demo.theme.zip')
