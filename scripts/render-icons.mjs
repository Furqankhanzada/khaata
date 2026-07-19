// Render the PNG app icons from scripts/icon-mark.svg. Run: node scripts/render-icons.mjs
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const svg = readFileSync(new URL('./icon-mark.svg', import.meta.url))
const out = new URL('../web/public/', import.meta.url)
const targets = [
  ['apple-touch-icon.png', 180], // iOS home screen (no transparency, iOS rounds it)
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]
for (const [name, size] of targets) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(new URL(name, out).pathname)
  console.log(`wrote web/public/${name} (${size})`)
}
