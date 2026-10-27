import { execFileSync } from 'node:child_process'
import { stat, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const supported = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif'])
const base = process.env.BASE_SHA || ''
const head = process.env.GITHUB_SHA || 'HEAD'
const isZero = !base || /^0+$/.test(base)
const range = isZero ? head + '^..' + head : base + '..' + head

let files = []
try {
  const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', range, '--', 'posts'], { encoding: 'utf8' })
  files = output.split('\n').map((line) => line.trim()).filter(Boolean)
} catch (error) {
  console.warn('Unable to get changed files:', error.message)
}

let changed = 0
let saved = 0

for (const file of files) {
  const ext = path.extname(file).toLowerCase()
  if (!supported.has(ext)) continue

  const input = await readFile(file)
  const meta = await sharp(input).metadata()
  if ((meta.pages || 1) > 1) {
    console.log('Skip animated image:', file)
    continue
  }

  let pipeline = sharp(input).rotate()
  if (ext === '.png') {
    pipeline = pipeline.png({ quality: 80, compressionLevel: 9, palette: true })
  } else if (ext === '.jpg' || ext === '.jpeg') {
    pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true, progressive: true })
  } else if (ext === '.webp') {
    pipeline = pipeline.webp({ quality: 82, effort: 5 })
  } else if (ext === '.avif') {
    pipeline = pipeline.avif({ quality: 60, effort: 4 })
  }

  const output = await pipeline.toBuffer()
  const before = (await stat(file)).size
  const after = output.length
  const diff = before - after
  const pct = (diff / before) * 100

  if (diff >= 1024 && pct >= 5) {
    await writeFile(file, output)
    changed += 1
    saved += diff
    console.log('Optimized ' + file + ': ' + before + ' -> ' + after + ' bytes')
  } else {
    console.log('Keep ' + file + ': ' + before + ' -> ' + after + ' bytes')
  }
}

console.log('Optimized ' + changed + ' images, saved ' + saved + ' bytes.')
