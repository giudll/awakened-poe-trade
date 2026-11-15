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
import { parseStatDescriptions, buildTextPairs, detectChineseSlot, DEFAULT_CHINESE_SLOT } from './lib/statdesc.mjs'
import { readDatc64 } from './lib/datc64.mjs'
import { readOverlay, mergeStats } from './lib/overlay.mjs'
import { getPatchZip } from './lib/patch.mjs'
import ANOINT_ZH from './data/anoint-zh.mjs'
import ULTIMATUM_ZH from './data/ultimatum-zh.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DATA = path.join(ROOT, 'renderer/public/data')

export const TARGET_LANG = DEFAULT_CHINESE_SLOT

export async function readStatBlocksFromPatch (zipBuffer) {
  // The 3.30 patch renamed `*.txt` to `*.csd`; the content is still UTF-16 text.
  const all = listZipEntries(zipBuffer).filter(e =>
    e.name.toLowerCase().startsWith('metadata/statdescriptions/') && !e.name.endsWith('/'))
  const entries = all.filter(e => /\.(txt|csd)$/.test(e.name.toLowerCase()))
  if (!entries.length) {
    const exts = [...new Set(all.map(e => {
      const slash = e.name.lastIndexOf('/')
      const dot = e.name.lastIndexOf('.')
      return dot > slash ? e.name.slice(dot).toLowerCase() : '(no extension)'
    }))]
    throw new Error('Patch zip has no Metadata/StatDescriptions/*.txt|*.csd ' +
      `(found ${all.length} entries there, extensions: ${exts.join(', ') || 'none'}) ` +
      '- the patch changed shape, teach readStatBlocksFromPatch about it')
  }

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

// Cluster jewels are the one place where the client stitches a line together
// instead of looking the whole sentence up: `Metadata/StatDescriptions` only
// carries "Added Small Passive Skills *also* grant: <effect>", while the plain
// "grant" variant is rendered from a ClientStrings template
// (`StatDescripotionTreeExpansionJewelGrantedSmallStat`, note GGG's typo) whose
// `{0}` is the granted effect's own stat text. The patch translations live in
// two different files, so no English text ever has a Chinese twin here and the
// price check shows "unrecognised modifier" for every medium/large cluster
// jewel enchant. Rebuild the sentence the client renders.
const GRANT_PREFIX = 'Added Small Passive Skills grant: '

// Anointments have the same problem: `Allocates Vampirism` is one line in the
// trade data, but the client builds it from `配置 {0}` plus the passive's name
// out of `PassiveSkills.dat`. See `data/anoint-zh.mjs`.
const ALLOCATES_PREFIX = 'Allocates '

/** @returns {string | null} the Chinese prefix, `{0}` already stripped */
export function readClusterGrantPrefix (zipBuffer) {
  const entry = listZipEntries(zipBuffer).find(e =>
    e.name.toLowerCase() === 'data/traditional chinese/clientstrings.datc64')
  if (!entry) return null

  const dat = readDatc64(readZipEntry(zipBuffer, entry))
  const dv = dat.dataVariable
  let start = 0
  for (let i = 0; i + 1 < dv.length; i += 2) {
    if (dv.readUInt16LE(i) !== 0) continue
    if (i > start) {
      const text = dv.subarray(start, i).toString('utf16le')
      if (/^增加的小天赋获得：\{0\}$/.test(text)) return text.slice(0, -3)
    }
    start = i + 2
  }
  return null
}

/** Replaces the numbers so the line can be looked up as a stat template. */
function toStatTemplate (text) {
  return text.replace(/\d+(?:\.\d+)?/g, '#')
}

function lookupGrantedEffect (pairs, effect) {
  const unsigned = effect.replace(/^\+\s*/, '')
  for (const candidate of [effect, toStatTemplate(effect), unsigned, toStatTemplate(unsigned)]) {
    const hit = pairs.get(candidate)
    if (!hit?.size) continue
    const variants = [...hit]
    // One English template can serve several stats. The local ("该装备的…")
    // wording belongs to the equippable copy of the stat, so only fall back to
    // it when there is nothing else; otherwise take the longest variant, which
    // is the fully spelled out one ("…格挡几率" over "…格挡率").
    const specific = variants.filter(v => !v.includes('该装备的'))
    const pool = specific.length ? specific : variants
    return pool.reduce((a, b) => (b.length > a.length ? b : a))
  }
  return null
}

export function synthesizeClusterGrant (pairs, prefixCn, enText) {
  const lines = []
  for (const line of enText.split('\n')) {
    if (!line.startsWith(GRANT_PREFIX)) return null
    const effect = lookupGrantedEffect(pairs, line.slice(GRANT_PREFIX.length).trim())
    if (!effect) return null
    lines.push(prefixCn + effect)
  }
  return lines.join('\n')
}

/** @returns {Promise<{ stats: any[], report: any }>} */
export async function buildStats ({ zipBuffer, quiet = false }) {
  const blocks = await readStatBlocksFromPatch(zipBuffer)

  // Never trust the slot label: the patch swaps the two Chinese slots, and the
  // texts are not glyph variants of each other (see lib/statdesc.mjs).
  const detected = detectChineseSlot(blocks)
  if (!detected) throw new Error('Patch has no Chinese stat descriptions')
  if (detected.swapped && !quiet) {
    console.warn(`! Chinese slots are labelled against their content: reading "${detected.slot}"`)
  }

  const { pairs, stats: pairStats } = buildTextPairs(blocks, detected.slot)

  // Every Chinese string the bundle emits has to be traceable to the patch, byte
  // for byte. Old builds were made by converting the traditional text to
  // simplified, which is right for most characters and silently wrong for the
  // rest, so the check is on provenance, not on how much Chinese we got.
  const allowedCn = new Set()
  for (const set of pairs.values()) for (const text of set) allowedCn.add(text)

  // Every English line the patched client can print. A record whose text is not
  // in here is a stat the current version deleted, so it is not part of what the
  // localization has to cover.
  const patchEn = new Set()
  for (const block of blocks) {
    for (const text of block.byLang.get('English') ?? []) patchEn.add(text.trim())
  }
  const stripTags = s => s.replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1')
  const isStaleLine = (stat) => !(stat.matchers ?? []).some(m =>
    patchEn.has(m.string) || patchEn.has(stripTags(m.string).trim()))
  const grantPrefixCn = readClusterGrantPrefix(zipBuffer)
  const allocatesPrefix = (() => {
    const first = [...(pairs.get('Allocates #') ?? [])][0]
    return first?.endsWith('#') ? first.slice(0, -1) : '配置 '
  })()

  const enText = await readFile(path.join(DATA, 'en/stats.ndjson'), 'utf-8')
  const records = readNdjson(enText)

  // Stats the skeleton does not ship yet, plus trade ids for a domain the
  // skeleton forgot. Purely additive: anything upstream already has wins, so an
  // upstream refresh converges back to upstream's data on its own.
  const overlay = await readOverlay()
  const mergedStats = mergeStats(records, overlay)
  const allRecords = mergedStats.records

  const report = {
    zhSlot: { used: detected.slot, swapped: detected.swapped, counts: detected.counts },
    patchBlocks: pairStats.blocks,
    englishTexts: pairStats.en,
    translatedBlocks: pairStats.translated,
    enToCnTexts: pairs.size,
    records: records.length,
    recordsEmitted: allRecords.length,
    overlay: {
      items: { added: 0, superseded: 0 }, // filled by build-items, kept here for the lock
      stats: { added: 0, translated: 0, superseded: mergedStats.report.superseded },
      statIds: { added: mergedStats.report.domainsAdded, kept: mergedStats.report.domainsKept }
    },
    recordsTranslated: 0,
    matchersAdded: 0,
    recordsUntranslated: [],
    cnCollisions: [],
    enStringCollisions: 0,
    coverageByType: {},
    clusterGrant: { prefix: grantPrefixCn, synthesized: 0, failed: [] },
    anoints: { prefix: allocatesPrefix, synthesized: 0, known: Object.keys(ANOINT_ZH).length },
    ultimatum: { records: 0 },
    realMods: { total: 0, translated: 0, stale: 0, staleTranslated: 0 },
    provenance: { chineseMatchers: 0, violations: [] }
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

  const out = allRecords.map((rec, recIdx) => {
    const clone = structuredClone(rec)
    let added = 0
    // Records the overlay created are not part of what the localization has to
    // cover: the skeleton never had that line, 编年史 has not translated it, and
    // counting it as untranslated would pull the gate below its threshold for
    // reasons that have nothing to do with the localization being broken.
    const fromOverlay = mergedStats.addedRefs.has(flatten(clone)[0].ref)

    for (const stat of flatten(clone)) {
      const extra = []
      for (const matcher of stat.matchers) {
        let cn = pairs.get(matcher.string.trim())
        if (!cn && grantPrefixCn && matcher.string.startsWith(GRANT_PREFIX)) {
          const rebuilt = synthesizeClusterGrant(pairs, grantPrefixCn, matcher.string)
          if (rebuilt) {
            cn = new Set([rebuilt])
            allowedCn.add(rebuilt)
            report.clusterGrant.synthesized += 1
          } else {
            report.clusterGrant.failed.push(matcher.string)
          }
        }
        if (!cn && matcher.string.startsWith(ALLOCATES_PREFIX)) {
          const zhName = ANOINT_ZH[matcher.string.slice(ALLOCATES_PREFIX.length)]
          if (zhName) {
            const anointed = allocatesPrefix + zhName
            cn = new Set([anointed])
            allowedCn.add(anointed)
            report.anoints.synthesized += 1
          }
        }
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
      // The Chinese matchers go *first*, not last. `translateStatWithRoll` in
      // `renderer/src/parser/modifiers.ts` takes the first matcher whose
      // `value` is unset (`matchers.find(m => m.value == null)`), so appending
      // them would leave the English text on screen - the exact bug this fork
      // exists to fix. Order does not affect parsing: the item parser scans
      // every matcher with `.some()`, so English item text still resolves.
      stat.matchers.unshift(...extra)
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
        if (fromOverlay) {
          report.overlay.stats.added += 1
          if (added) report.overlay.stats.translated += 1
        } else {
          report.realMods.total += 1
          if (added) report.realMods.translated += 1
          // The English skeleton can still carry lines this patch no longer
          // contains: stats a balance patch deleted. They can never appear on an
          // item again, so counting them as untranslated understates the bundle.
          if (isStaleLine(stat)) {
            report.realMods.stale += 1
            if (added) report.realMods.staleTranslated += 1
          }
        }
      }
    }

    return clone
  })

  report.realMods.current = report.realMods.total - report.realMods.stale
  report.realMods.currentTranslated = report.realMods.translated - report.realMods.staleTranslated

  // Ultimatum modifiers are missing from the English snapshot altogether (the
  // trade site keeps them in their own `ultimatum` group), so there is nothing
  // to attach a translation to - the records have to be created from scratch.
  // Only the Chinese line is used for matching; the English one is kept so items
  // copied from an English client still resolve.
  for (const [ids, en, cn] of ULTIMATUM_ZH) {
    out.push({
      ref: en,
      matchers: [{ string: cn }, { string: en }],
      trade: { ids: { explicit: Array.isArray(ids) ? ids : [ids] } }
    })
    allowedCn.add(cn)
    report.ultimatum.records += 1
  }

  for (const [text, recs] of cnToRecords) {
    if (recs.size > 1) report.cnCollisions.push({ text, records: recs.size })
  }
  report.cnCollisions.sort((a, b) => b.records - a.records)

  // Provenance gate. The client shows exactly what the patch contains, so every
  // Chinese matcher must be one of those strings verbatim (or a documented
  // synthesis from several of them). Anything else - typically the output of a
  // traditional-to-simplified conversion - can never match the game text, so it
  // is a silent failure rather than a cosmetic one and has to stop the build.
  let violationCount = 0
  for (const rec of out) {
    for (const stat of flatten(rec)) {
      for (const matcher of stat.matchers ?? []) {
        if (!/[\u4e00-\u9fff]/.test(matcher.string)) continue
        report.provenance.chineseMatchers += 1
        if (allowedCn.has(matcher.string)) continue
        violationCount += 1
        if (report.provenance.violations.length < 50) {
          report.provenance.violations.push({ ref: stat.ref, string: matcher.string })
        }
      }
    }
  }
  if (violationCount) {
    const samples = report.provenance.violations
      .slice(0, 5)
      .map(v => `  ${JSON.stringify(v.string)}\n    <- ${v.ref}`)
      .join('\n')
    throw new Error(`${violationCount} Chinese matcher(s) are not verbatim patch text ` +
      `(reading slot "${detected.slot}"). Refusing to write data that cannot match the client.\n${samples}`)
  }

  const ndjson = out.map(r => JSON.stringify(r)).join('\n') + '\n'

  if (!quiet) {
    console.log(`chinese slot: "${report.zhSlot.used}"` +
      `${report.zhSlot.swapped ? ' (labels are swapped in the patch)' : ''}, ` +
      `all ${report.provenance.chineseMatchers} chinese matchers verbatim from the patch`)
    console.log(`patch blocks: ${report.patchBlocks}, en texts: ${report.englishTexts}, ` +
      `translated blocks: ${report.translatedBlocks}, en->cn texts: ${report.enToCnTexts}`)
    console.log(`records: ${report.records}, translated: ${report.recordsTranslated} ` +
      `(${(100 * report.recordsTranslated / report.records).toFixed(1)}%), matchers added: ${report.matchersAdded}`)
    console.log(`cluster jewel "grant" lines rebuilt: ${report.clusterGrant.synthesized}` +
      `${report.clusterGrant.prefix ? '' : ' (WARNING: ClientStrings template not found)'}` +
      `${report.clusterGrant.failed.length ? `, unmatched: ${report.clusterGrant.failed.length}` : ''}`)
    console.log(`ultimatum modifier records created: ${report.ultimatum.records}`)
    console.log(`overlay: ${mergedStats.report.domainsAdded} trade id domains filled in ` +
      `(${mergedStats.report.domainsKept} already upstream), ` +
      `${report.overlay.stats.added} stat records added ` +
      `(${report.overlay.stats.translated} of them have Chinese already` +
      `${report.overlay.stats.superseded ? `, ${report.overlay.stats.superseded} already upstream` : ''})`)
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
    console.log(`  of those, lines this patch no longer contains: ${report.realMods.stale} ` +
      `(coverage of what the client can actually show: ` +
      `${report.realMods.currentTranslated}/${report.realMods.current} = ` +
      `${(100 * report.realMods.currentTranslated / report.realMods.current).toFixed(1)}%)`)
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
    clusterGrant: { ...report.clusterGrant, failed: report.clusterGrant.failed.slice(0, 100) },
    cnCollisions: report.cnCollisions.slice(0, 200)
  }, null, 2))
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => { console.error(err); process.exit(1) })
}
