// Builds `renderer/public/data/zh_CN/items.ndjson`.
//
// `items.ndjson` needs, per record, the localized display name (`name`) plus the
// language independent English `refName` (used when querying the international
// trade site, see `t()` in price-check filters).
//
// **Every Chinese name emitted here is a string that exists verbatim in the 编年史
// patch.** Nothing is translated, transliterated or guessed by this script: the
// client is patched to 编年史's Simplified Chinese, so a name that 编年史 does not
// have is simply shown in English in game - and keeping it English is exactly
// what makes those items recognisable when their text is pasted in.
//
// Sources, in order of authority:
//   1. `words.datc64` - one row holds the English *and* the Chinese name, so the
//      pairing for unique items is exact.
//   2. `baseitemtypes.datc64` matched by Id - the Id is language independent, so
//      `.../DivinationCards/DivinationCardAssassinsFavour` pairs with
//      `Assassin's Favour` without comparing any text.
//   3. transfigured gems, whose display name is not a base item type at all: it is
//      composed as `<word>之<base gem>` (e.g. `Absolution of Inspiring` ->
//      `奋发之赦罪`) and only accepted when the patch itself contains that skill
//      name.
//   4. `data/pair-hints.json` - (namespace, refName) -> Chinese *hint*, used only
//      to propose a pairing for plain base types, whose Ids (`GlovesDexInt10`)
//      carry no name at all. A hint is accepted only when it is found verbatim in
//      `baseitemtypes.datc64` and the matched Id belongs to that namespace's
//      table; otherwise the item stays English.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPatchZip } from './lib/patch.mjs'
import { readPatchNames, normId } from './lib/patch-names.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DATA = path.join(ROOT, 'renderer/public/data')
const HINTS_PATH = path.join(__dirname, 'data/pair-hints.json')

// Support gems are stored as `附加混沌伤害(辅)` / `（强辅）`, `蛊咒【强辅】`, and map
// items as `塑界守卫地图`; hints often drop or reshape the suffix.
const REPAIR_SUFFIXES = ['(辅)', '（辅）', '(强辅)', '（强辅）', '【强辅】', '【仿品】', '地图']

// Purely decorative markers the hint source uses to rank item value.
// Note that `【…】` is NOT one of them: the game itself names awakened gems
// `蛊咒【强辅】` and replica uniques `深渊之唤【仿品】`.
const DECORATION_CHARS = /[★☆◆◇♥♡✿❀※●○■□▲△]/g
// Category prefixes that the hint source puts in front of map/area names.
const CATEGORY_PREFIX = /^(?:地图|区域|地区|AREA|MAP)[:：]\s*/i

export function cleanHint (raw) {
  if (typeof raw !== 'string') return null
  let s = raw
    .replace(DECORATION_CHARS, '')
    .replace(/\[[^\]]*\]/g, '') // harvest / atlas annotations
    .replace(/[（(][A-Za-z0-9 '.,\u00c0-\u024f-]*[）)]/g, '') // `嗜血滑行者(Acid Slitherer)`
    .replace(CATEGORY_PREFIX, '')
  // a trailing note after the name itself (`塞尔.布雷德狼穴 3匹狼 [无攻词]`)
  s = s.split(/[\s\u3000]/)[0]
  s = s.replace(/[,;，；]+$/, '').trim()
  return s || null
}

/** The game data is inconsistent about `()` vs `（）` vs `【】` around gem suffixes. */
function parenVariants (s) {
  const toFull = s.replace(/[()【】]/g, (c) => (c === ')' || c === '】' ? '）' : '（'))
  const toHalf = s.replace(/[（）【】]/g, (c) => (c === '）' || c === '】' ? ')' : '('))
  return [s, toFull, toHalf]
}

/** Does a base item type Id belong to the table a namespace is priced from? */
function idFitsNamespace (namespace, id) {
  const lower = id.toLowerCase()
  const isGem = lower.includes('/gems/')
  const isCard = lower.includes('/divinationcards/')
  switch (namespace) {
    case 'DIVINATION_CARD': return isCard
    case 'GEM': return isGem
    // Everything else on the trade site is a plain base type; gems and cards have
    // their own namespaces, so a name resolving to one of those is a bad link.
    case 'ITEM': return !isGem && !isCard
    default: return false
  }
}

/**
 * Accepts a hinted name only when the patch contains it verbatim.
 * `repaired` means a known suffix shape had to be restored.
 */
export function verifyHint (cn, namespace, baseTypeByName) {
  const candidates = []
  for (const variant of parenVariants(cn)) {
    candidates.push(variant)
    for (const suffix of REPAIR_SUFFIXES) candidates.push(variant + suffix)
    const stem = variant.replace(/[（(【][^）)】]*[）)】]$/, '')
    if (stem !== variant) {
      candidates.push(stem)
      for (const suffix of REPAIR_SUFFIXES) candidates.push(stem + suffix)
    }
  }

  for (const candidate of candidates) {
    const row = baseTypeByName.get(candidate)
    if (!row) continue
    if (!idFitsNamespace(namespace, row.id)) continue
    return { name: candidate, how: candidate === cn ? 'verified' : 'repaired' }
  }
  return null
}

/**
 * Variant gems (`Absolution of Inspiring`, `Animate Guardian of Smiting`) have no
 * row in `baseitemtypes`; their displayed name is a skill name (`奋发之赦罪`) that
 * only exists in `activeskills`. A hint is accepted only when the patch contains
 * that skill name *and* it ends with the base gem's own name, so the pairing is
 * checked from both ends.
 */
export function verifyGemHint (cn, refName, patch) {
  if (!patch.skillNames.has(cn)) return null
  const m = /^(.+?) of (.+)$/.exec(refName)
  if (!m) return null

  const rows = (patch.baseTypeByNormId.get(normId(`SkillGem${m[1]}`)) ?? [])
    .filter(r => idFitsNamespace('GEM', r.id))
  if (new Set(rows.map(r => r.name)).size !== 1) return null
  return cn.endsWith(rows[0].name) ? { name: cn, how: 'gemVariant' } : null
}

function readNdjson (text) {
  return text.split('\n').filter(l => l.length).map(l => JSON.parse(l))
}

async function readHints () {
  try {
    return JSON.parse(await readFile(HINTS_PATH, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

/**
 * Rebuilds the hint table from another bundle's `items.ndjson`.
 *
 * The hint file is *not* a translation source - it only says "these two names
 * probably denote the same item". Whatever it proposes still has to be found in
 * the patch before it is used.
 */
export async function updateHints (sourcePath) {
  const source = readNdjson(await readFile(sourcePath, 'utf8'))
  const hints = {}
  for (const item of source) {
    if (!item.name || !item.refName) continue
    if (item.name === item.refName) continue
    hints[`${item.namespace}::${item.refName}`] = item.name
  }
  await writeFile(HINTS_PATH, JSON.stringify(hints, null, 0) + '\n')
  return hints
}

export async function buildItems ({ zipBuffer, hints, quiet = false }) {
  const en = readNdjson(await readFile(path.join(DATA, 'en/items.ndjson'), 'utf8'))
  const patch = readPatchNames(zipBuffer)
  const hintTable = hints ?? await readHints()

  const baseTypeByName = new Map()
  for (const row of patch.baseTypes) if (!baseTypeByName.has(row.name)) baseTypeByName.set(row.name, row)
  const wordNames = new Set(patch.words.values())

  const report = {
    records: en.length,
    translated: 0,
    byNamespace: {},
    sources: { words: 0, idMatch: 0, gemVariant: 0, verified: 0, repaired: 0, englishOnly: 0 },
    englishOnly: [],
    rejectedHints: [],
    refNameNotAdjacent: 0,
    patch: {
      words: patch.words.size,
      baseTypes: patch.baseTypes.length,
      clientStrings: patch.clientStrings.size,
      skillNames: patch.skillNames.size,
      vocabulary: patch.vocabulary.size
    }
  }

  const out = en.map((item) => {
    const stats = (report.byNamespace[item.namespace] ??= { total: 0, translated: 0 })
    stats.total += 1
    const hint = hintTable[`${item.namespace}::${item.refName}`]

    /** @returns {{name: string, how: string}|null} */
    const resolve = () => {
      // 1. exact pairing from `words`
      const wordName = patch.words.get(item.refName)
      if (wordName) return { name: wordName, how: 'words' }

      // 2. language independent Id
      if (item.namespace === 'AREA') {
        const areas = patch.areaByNormId.get(normId(item.refName)) ?? []
        if (areas.length === 1) return { name: areas[0], how: 'idMatch' }
      } else {
        const byId = patch.baseTypeByNormId.get(normId(item.refName)) ?? []
        const idFits = byId.filter(r => idFitsNamespace(item.namespace, r.id))
        if (idFits.length && new Set(idFits.map(r => r.name)).size === 1) {
          return { name: idFits[0].name, how: 'idMatch' }
        }
      }

      // 3. variant gems, whose name only exists as a skill name
      if (item.namespace === 'GEM' && hint) {
        const cleaned = cleanHint(hint)
        const variant = cleaned ? verifyGemHint(cleaned, item.refName, patch) : null
        if (variant) return variant
      }

      // 4. hinted pairing, verified against the patch
      const cleaned = hint ? cleanHint(hint) : null
      if (cleaned) {
        if (item.namespace === 'AREA') {
          return patch.areaNames.has(cleaned) ? { name: cleaned, how: 'verified' } : null
        }
        if (item.namespace === 'UNIQUE') {
          const variant = parenVariants(cleaned).find(v => wordNames.has(v))
          if (variant) return { name: variant, how: variant === cleaned ? 'verified' : 'repaired' }
          return null
        }
        return verifyHint(cleaned, item.namespace, baseTypeByName)
      }
      return null
    }

    const resolved = resolve()
    if (!resolved) {
      report.sources.englishOnly += 1
      if (report.englishOnly.length < 40) {
        report.englishOnly.push({ ns: item.namespace, refName: item.refName, hint })
      }
      if (hint && report.rejectedHints.length < 40) {
        report.rejectedHints.push({ ns: item.namespace, refName: item.refName, hint })
      }
      return item
    }

    report.translated += 1
    stats.translated += 1
    report.sources[resolved.how] += 1
    return { ...item, name: resolved.name }
  })

  // The invariant this whole file exists for: no name may come from anywhere but
  // the patch. If a route above ever emits something else, fail loudly instead of
  // shipping text the game will never print.
  {
    const known = new Set([
      ...patch.baseTypeNames,
      ...wordNames,
      ...patch.skillNames,
      ...patch.areaNames
    ])
    const foreign = out.filter(item => item.name !== item.refName && !known.has(item.name))
    if (foreign.length) {
      throw new Error(`names not found in the 编年史 patch: ${foreign.slice(0, 5)
        .map(f => `${f.namespace} ${f.refName} -> ${f.name}`).join('; ')}`)
    }
    report.foreignNames = foreign.length
  }

  // The lookup index assumes records that share a name are adjacent.
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  // `ITEM_BY_REF` walks forward from the first record of a refName group, so the
  // same must hold for refName. Report violations instead of silently degrading.
  const seen = new Set()
  let prev = null
  for (const item of out) {
    const key = `${item.namespace}::${item.refName}`
    if (key !== prev && seen.has(key)) report.refNameNotAdjacent += 1
    seen.add(key)
    prev = key
  }

  if (!quiet) {
    console.log(`items: ${report.translated}/${report.records} names in Simplified Chinese ` +
      `(${(100 * report.translated / report.records).toFixed(1)}%), ` +
      `${report.sources.englishOnly} kept English (not in 编年史)`)
    console.log(`  sources: ${Object.entries(report.sources).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    Object.entries(report.byNamespace)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([ns, v]) => console.log(
        `  ${ns.padEnd(16)} ${String(v.translated).padStart(5)}/${String(v.total).padStart(5)} ` +
        `${(100 * v.translated / v.total).toFixed(1)}%`))
    if (report.rejectedHints.length) {
      console.log(`  ! hints not found in 编年史, kept English (first ${Math.min(6, report.rejectedHints.length)}):`)
      report.rejectedHints.slice(0, 6).forEach(u => console.log(`      ${u.ns} ${u.refName}  (hint: ${u.hint})`))
    }
    if (report.refNameNotAdjacent) {
      console.log(`  ! refName groups that are not contiguous: ${report.refNameNotAdjacent}`)
    }
  }

  return { ndjson: out.map(i => JSON.stringify(i)).join('\n') + '\n', report }
}

async function main () {
  const localZip = process.argv.find(a => a.startsWith('--zip='))?.slice(6)
  const sourceArg = process.argv.find(a => a.startsWith('--source='))?.slice(9)

  if (sourceArg) {
    console.log(`rebuilding pair hints from ${sourceArg}`)
    await updateHints(sourceArg)
    return
  }

  const { buffer, version, md5 } = await getPatchZip({ localZip })
  console.log(`patch: version=${version} md5=${md5 || '(local)'}`)

  const { ndjson, report } = await buildItems({ zipBuffer: buffer })
  const outPath = path.join(DATA, 'zh_CN/items.ndjson')
  await writeFile(outPath, ndjson)
  console.log(`wrote ${outPath} (${(ndjson.length / 1048576).toFixed(1)}MB)`)
  await writeFile(path.join(__dirname, 'out-items-report.json'),
    JSON.stringify({ version, md5, ...report }, null, 2))
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => { console.error(err); process.exit(1) })
}
