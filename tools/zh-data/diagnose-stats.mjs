// Diagnoses why a stat has no Chinese matcher.
//
// Reads the 编年史 stat descriptions and the current zh_CN bundle, then for every
// English matcher that has no Chinese counterpart tries progressively looser
// joins, and reports how many each strategy recovers plus samples, so the
// recovered pairs can be eyeballed for correctness before trusting them.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listZipEntries, readZipEntry } from './lib/zip.mjs'
import { parseStatDescriptions, buildTextPairs } from './lib/statdesc.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DATA = path.join(ROOT, 'renderer/public/data')
const zipPath = process.argv[2]
if (!zipPath) throw new Error('usage: node diagnose-stats.mjs <patch.zip>')

const zip = fs.readFileSync(zipPath)
const entries = listZipEntries(zip).filter(e =>
  e.name.toLowerCase().startsWith('metadata/statdescriptions/') && e.name.toLowerCase().endsWith('.txt'))
const blocks = []
for (const entry of entries) {
  const text = readZipEntry(zip, entry).toString('utf16le').replace(/^\uFEFF/, '')
  blocks.push(...parseStatDescriptions(text))
}
const { pairs } = buildTextPairs(blocks, 'Traditional Chinese')
console.log(`patch blocks: ${blocks.length}, en->cn pairs: ${pairs.size}`)

const readNdjson = f => fs.readFileSync(f, 'utf8').trim().split('\n')
  .map(l => { const r = JSON.parse(l); return (r.stats ?? [r])[0] })

const zhTexts = new Set()
const untranslated = []
for (const s of readNdjson(path.join(DATA, 'zh_CN/stats.ndjson'))) {
  if (!s?.matchers) continue
  const cjk = s.matchers.filter(m => /[\u4e00-\u9fff]/.test(m.string)).map(m => m.string)
  for (const c of cjk) zhTexts.add(c)
  if (cjk.length) continue
  const types = Object.keys(s.trade?.ids ?? {}).join('+')
  untranslated.push({ ref: s.ref, types, strings: s.matchers.map(m => m.string) })
}

// Looser joins, from safest to loosest.
const fold = s => s
  .toLowerCase()
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()

const foldAggressive = s => fold(s)
  .replace(/[.]/g, '')
  .replace(/,/g, '')
  .replace(/\s*-\s*/g, '-')
  .replace(/:$/, '')

const byFold = new Map()
const byAggressive = new Map()
for (const [en, cnSet] of pairs) {
  const k1 = fold(en)
  if (!byFold.has(k1)) byFold.set(k1, new Set())
  for (const c of cnSet) byFold.get(k1).add(c)
  const k2 = foldAggressive(en)
  if (!byAggressive.has(k2)) byAggressive.set(k2, new Set())
  for (const c of cnSet) byAggressive.get(k2).add(c)
}

const stats = { exactMissing: 0, fold: [], aggressive: [], none: 0 }
for (const item of untranslated) {
  let recovered = null
  for (const str of item.strings) {
    const k = fold(str)
    if (byFold.has(k)) { recovered = { how: 'fold', str, cn: [...byFold.get(k)] }; break }
  }
  if (!recovered) {
    for (const str of item.strings) {
      const k = foldAggressive(str)
      if (byAggressive.has(k)) { recovered = { how: 'aggressive', str, cn: [...byAggressive.get(k)] }; break }
    }
  }
  if (!recovered) { stats.none += 1; continue }
  stats[recovered.how].push({ ref: item.ref, types: item.types, ...recovered })
}

console.log(`\nuntranslated stats: ${untranslated.length}`)
console.log(`  recoverable by case/space/punctuation fold: ${stats.fold.length}`)
console.log(`  recoverable by dropping dots/commas too:    ${stats.aggressive.length}`)
console.log(`  no counterpart in the patch:                ${stats.none}`)

const sample = (label, list) => {
  console.log(`\n=== ${label} (${list.length}) ===`)
  for (const r of list.slice(0, 40)) {
    console.log(`${r.types}\t${JSON.stringify(r.str)}\n\t-> ${JSON.stringify(r.cn.slice(0, 3))}`)
  }
}
sample('fold', stats.fold)
sample('aggressive', stats.aggressive)

const noneList = untranslated.filter(u => !stats.fold.some(f => f.ref === u.ref) && !stats.aggressive.some(a => a.ref === u.ref))
const byType = {}
for (const u of noneList) byType[u.types] = (byType[u.types] ?? 0) + 1
console.log('\n=== no counterpart, by trade type ===')
console.log(JSON.stringify(byType, null, 1))
console.log('\n=== no counterpart, explicit/implicit samples ===')
for (const u of noneList.filter(u => u.types === 'explicit' || u.types === 'implicit').slice(0, 40)) {
  console.log(`${u.types}\t${JSON.stringify(u.ref)}`)
}
fs.writeFileSync(path.join(__dirname, 'out-diagnose.json'), JSON.stringify({
  untranslated: untranslated.length,
  fold: stats.fold,
  aggressive: stats.aggressive,
  none: noneList.map(u => ({ ref: u.ref, types: u.types }))
}, null, 2))
