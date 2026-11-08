// Builds `renderer/public/data/zh_CN/stats.ndjson`.
//
// Strategy: take the shipped English data as the source of truth for `ref`,
// `trade.ids`, `better`, `anointments`, resolver groups, etc., and append the
// Simplified Chinese matcher strings to every record. The result is a bilingual
// index: English lines keep working (so untranslated new content still parses),
// and Chinese lines resolve to the exactly same Stat objects, which means the
// trade query keeps sending the same language independent stat ids.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listZipEntries, readZipEntry } from './lib/zip.mjs'
import { parseStatDescriptions, buildTextPairs } from './lib/statdesc.mjs'
import { getPatchZip } from './lib/patch.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DATA = path.join(ROOT, 'renderer/public/data')

export const TARGET_LANG = 'Traditional Chinese'

export async function readStatBlocksFromPatch (zipBuffer) {
  const entries = listZipEntries(zipBuffer).filter(e =>
    e.name.toLowerCase().startsWith('metadata/statdescriptions/') && e.name.toLowerCase().endsWith('.txt'))
  if (!entries.length) throw new Error('Patch zip has no Metadata/StatDescriptions/*.txt')

  const blocks = []
  for (const entry of entries) {
    const buf = readZipEntry(zipBuffer, entry)
    // UTF-16LE with BOM
    const text = buf.toString('utf16le').replace(/^\uFEFF/, '')
    blocks.push(...parseStatDescriptions(text))
  }
  return blocks
}

function readNdjson (text) {
  return text.split('\n').filter(l => l.length).map(l => JSON.parse(l))
}

/** @returns {Promise<{ stats: any[], report: any }>} */
export async function buildStats ({ zipBuffer, quiet = false }) {
  const blocks = await readStatBlocksFromPatch(zipBuffer)
  const { pairs, stats: pairStats } = buildTextPairs(blocks, TARGET_LANG)

  const enText = await readFile(path.join(DATA, 'en/stats.ndjson'), 'utf-8')
  const records = readNdjson(enText)

  const report = {
    patchBlocks: pairStats.blocks,
    englishTexts: pairStats.en,
    translatedBlocks: pairStats.translated,
    enToCnTexts: pairs.size,
    records: records.length,
    recordsTranslated: 0,
    matchersAdded: 0,
    recordsUntranslated: [],
    cnCollisions: [],
    enStringCollisions: 0,
    coverageByType: {},
    realMods: { total: 0, translated: 0 }
  }

  // Stats that never appear as item text: pseudo aggregates, anointment
  // allocations and the synthetic "any skill gem" trade options.
  const isSyntheticRef = (ref) =>
    ref.startsWith('Allocates ') ||
    ref.includes('(Random Skill Gem)') ||
    ref.includes('Supported by ')

  /** @type {Map<string, Set<number>>} */
  const cnToRecords = new Map()

  const flatten = (rec) => ('stats' in rec ? rec.stats : [rec])

  // How ambiguous is the English data itself? Chinese collisions are expected
  // to mirror this, otherwise something is wrong with the join.
  {
    const owners = new Map()
    for (const rec of records) {
      for (const stat of flatten(rec)) {
        for (const matcher of stat.matchers) {
          let set = owners.get(matcher.string)
          if (!set) { set = new Set(); owners.set(matcher.string, set) }
          set.add(rec)
        }
      }
    }
    report.enStringCollisions = [...owners.values()].filter(s => s.size > 1).length
  }

  const out = records.map((rec, recIdx) => {
    const clone = structuredClone(rec)
    let added = 0

    for (const stat of flatten(clone)) {
      const extra = []
      for (const matcher of stat.matchers) {
        const cn = pairs.get(matcher.string.trim())
        if (!cn) continue
        for (const cnText of cn) {
          if (cnText === matcher.string) continue
          if (stat.matchers.some(m => m.string === cnText) || extra.some(m => m.string === cnText)) continue

          const translated = { string: cnText }
          if (matcher.value !== undefined) translated.value = matcher.value
          if (matcher.negate) translated.negate = true
          extra.push(translated)

          let set = cnToRecords.get(cnText)
          if (!set) { set = new Set(); cnToRecords.set(cnText, set) }
          set.add(recIdx)
        }
      }
      stat.matchers.push(...extra)
      added += extra.length
    }

    if (added) {
      report.recordsTranslated += 1
      report.matchersAdded += added
    } else {
      const stat = flatten(clone)[0]
      const types = Object.keys(stat.trade?.ids ?? {}).sort().join('+')
      report.recordsUntranslated.push({ ref: stat.ref, types })
    }

    for (const stat of flatten(clone)) {
      const types = Object.keys(stat.trade?.ids ?? {}).sort().join('+')
      report.coverageByType[types] ??= { total: 0, translated: 0 }
      report.coverageByType[types].total += 1
      if (added) report.coverageByType[types].translated += 1

      const onlyPseudo = Object.keys(stat.trade?.ids ?? {}).every(t => t === 'pseudo' || t === 'imbued')
      if (!onlyPseudo && !isSyntheticRef(stat.ref)) {
        report.realMods.total += 1
        if (added) report.realMods.translated += 1
      }
    }

    return clone
  })

  for (const [text, recs] of cnToRecords) {
    if (recs.size > 1) report.cnCollisions.push({ text, records: recs.size })
  }
  report.cnCollisions.sort((a, b) => b.records - a.records)

  const ndjson = out.map(r => JSON.stringify(r)).join('\n') + '\n'

  if (!quiet) {
    console.log(`patch blocks: ${report.patchBlocks}, en texts: ${report.englishTexts}, ` +
      `translated blocks: ${report.translatedBlocks}, en->cn texts: ${report.enToCnTexts}`)
    console.log(`records: ${report.records}, translated: ${report.recordsTranslated} ` +
      `(${(100 * report.recordsTranslated / report.records).toFixed(1)}%), matchers added: ${report.matchersAdded}`)
    console.log('by mod type:')
    Object.entries(report.coverageByType)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .forEach(([k, v]) => console.log(
        `  ${k.padEnd(44)} ${String(v.translated).padStart(5)}/${String(v.total).padStart(5)} ` +
        `${(100 * v.translated / v.total).toFixed(1)}%`))
    console.log(`cn text collisions (>1 record): ${report.cnCollisions.length} ` +
      `(english data has ${report.enStringCollisions} ambiguous strings)`)
    report.cnCollisions.slice(0, 5).forEach(c => console.log(`  ${c.records}x ${c.text}`))
    console.log(`real item mods: ${report.realMods.translated}/${report.realMods.total} = ` +
      `${(100 * report.realMods.translated / report.realMods.total).toFixed(1)}% ` +
      '(excludes pseudo / anointments / synthetic gem stats)')
  }

  return { ndjson, report }
}

async function main () {
  const localZip = process.argv.find(a => a.startsWith('--zip='))?.slice(6)
  const checkOnly = process.argv.includes('--check')

  const { buffer, version, md5 } = await getPatchZip({ localZip })
  console.log(`patch: version=${version} md5=${md5 || '(local)'} size=${(buffer.length / 1048576).toFixed(1)}MB`)

  const { ndjson, report } = await buildStats({ zipBuffer: buffer })

  if (!checkOnly) {
    const outPath = path.join(DATA, 'zh_CN/stats.ndjson')
    await writeFile(outPath, ndjson)
    console.log(`wrote ${outPath} (${(ndjson.length / 1048576).toFixed(1)}MB)`)
  }

  const { writeFile: wf } = await import('node:fs/promises')
  await wf(path.join(__dirname, 'out-stats-report.json'), JSON.stringify({
    version,
    md5,
    ...report,
    recordsUntranslated: report.recordsUntranslated.slice(0, 500),
    cnCollisions: report.cnCollisions.slice(0, 200)
  }, null, 2))
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => { console.error(err); process.exit(1) })
}
