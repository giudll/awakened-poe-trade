// Rebuilds `data/new-content.json` - the additive overlay of content that the
// English skeleton does not have yet. See `lib/overlay.mjs` for why it exists
// and why it cannot drift away from upstream.
//
//   node refresh-overlay.mjs                       # fetch both trade endpoints
//   node refresh-overlay.mjs --trade-items=cached.json --trade-stats=cached.json
//   node refresh-overlay.mjs --zip=../patch.zip    # local patch instead of the network
//   node refresh-overlay.mjs --only=Viscera,Graft  # item groups to include
//   node refresh-overlay.mjs --all-groups          # every group the trade site has
//   node refresh-overlay.mjs --dry-run             # print the diff, write nothing
//
// Run it after a league start or whenever an item is not recognised. Run it
// after an upstream update too: entries that upstream now ships are reported as
// `superseded` and dropped, so the file shrinks back to what is genuinely
// missing. Leaving it stale is harmless - `build-all` skips superseded entries
// anyway - but keeping it small keeps the diff readable.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPatchZip } from './lib/patch.mjs'
import { readStatBlocksFromPatch } from './build-stats.mjs'
import { OVERLAY_PATH } from './lib/overlay.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DATA = path.join(ROOT, 'renderer/public/data')

const TRADE_ITEMS_URL = 'https://www.pathofexile.com/api/trade/data/items'
const TRADE_STATS_URL = 'https://www.pathofexile.com/api/trade/data/stats'
const USER_AGENT = 'awakened-poe-trade-zh-cn (data bundle build)'

// Item groups the trade site added for the current league and that the skeleton
// cannot know about. `--all-groups` widens this to everything, which also pulls
// in maps / currency / itemised monsters - usually noise, because those never go
// through the item parser.
const DEFAULT_GROUPS = ['Viscera', 'Graft', 'Wombgift']

// Domains whose text can appear on an item. `pseudo` holds aggregate filters the
// trade site computes itself ("total resistance"), `crucible` holds whole
// multi-line trees with a "(Tier n)" suffix - neither is item text.
const SKIP_DOMAINS = new Set(['pseudo', 'crucible'])

const arg = (name, fallback = undefined) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback

const stripTags = (s) => s.replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1')
const normalize = (s) => s.trim().replace(/\s+/g, ' ')

/**
 * `+#% to Item Rarity` -> `+#% Item Rarity`, but only when the difference is
 * exactly one filler `to`. A wider normalisation would merge `(Local)` variants
 * and multi-line lines whose text merely shares a prefix, and those are
 * genuinely different trade filters.
 */
function findToVariant (text, baseByText) {
  const words = normalize(stripTags(text)).split(' ')
  for (let i = 1; i < words.length; i += 1) {
    if (words[i] !== 'to') continue
    const without = [...words.slice(0, i), ...words.slice(i + 1)].join(' ')
    const ref = baseByText.get(without)
    if (ref) return ref
  }
  return undefined
}

function readNdjson (text) {
  return text.split('\n').filter(l => l.length).map(l => JSON.parse(l))
}

async function loadJson (source, url) {
  if (source) {
    return { data: JSON.parse(await readFile(source, 'utf8')), origin: path.relative(process.cwd(), source) }
  }
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return { data: await res.json(), origin: url }
}

function sha256 (buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function main () {
  const dryRun = process.argv.includes('--dry-run')
  const allGroups = process.argv.includes('--all-groups')
  const groups = (arg('only') ?? DEFAULT_GROUPS.join(','))
    .split(',').map(s => s.trim()).filter(Boolean)

  const enItemsRaw = await readFile(path.join(DATA, 'en/items.ndjson'), 'utf8')
  const enStatsRaw = await readFile(path.join(DATA, 'en/stats.ndjson'), 'utf8')
  const baseItems = readNdjson(enItemsRaw)
  const baseStats = readNdjson(enStatsRaw)

  const patch = await getPatchZip({ localZip: arg('zip') })
  const blocks = await readStatBlocksFromPatch(patch.buffer)
  // English lines the patched client can actually print. A trade text outside
  // this set is a filter-only string (aggregate, atlas, ...) and adding a record
  // for it would only create noise in the modifier list.
  const patchEn = new Set()
  for (const block of blocks) {
    for (const text of block.byLang.get('English') ?? []) {
      patchEn.add(normalize(text))
      patchEn.add(normalize(stripTags(text)))
    }
  }

  // ---- items -------------------------------------------------------------
  const baseItemKeys = new Set(baseItems.map(i => `${i.namespace}::${i.refName}`))
  const baseRefNames = new Set(baseItems.map(i => i.refName))
  const tradeItems = await loadJson(arg('trade-items'), TRADE_ITEMS_URL)
  const items = []
  const itemsByGroup = {}
  for (const group of tradeItems.data.result ?? []) {
    if (!allGroups && !groups.includes(group.label)) continue
    for (const entry of group.entries ?? []) {
      const name = entry.type ?? entry.text
      if (!name || baseRefNames.has(name)) continue
      if (items.some(i => i.refName === name)) continue
      items.push({ namespace: 'ITEM', refName: name, group: group.label })
      itemsByGroup[group.label] = (itemsByGroup[group.label] ?? 0) + 1
    }
  }
  items.sort((a, b) => (a.refName < b.refName ? -1 : a.refName > b.refName ? 1 : 0))

  // ---- stats -------------------------------------------------------------
  /** every matcher string of the base data -> the record that owns it */
  const baseByText = new Map()
  /** ref -> the base stat object (to see which domains it already has) */
  const baseByRef = new Map()
  for (const rec of baseStats) {
    for (const stat of 'stats' in rec ? rec.stats : [rec]) {
      if (!baseByRef.has(stat.ref)) baseByRef.set(stat.ref, stat)
      // `ref` itself counts as known even when it is not one of the matcher
      // strings, otherwise the overlay re-adds a record that already exists.
      if (!baseByText.has(stat.ref)) baseByText.set(stat.ref, stat.ref)
      for (const matcher of stat.matchers ?? []) {
        if (!baseByText.has(matcher.string)) baseByText.set(matcher.string, stat.ref)
      }
    }
  }

  const tradeStats = await loadJson(arg('trade-stats'), TRADE_STATS_URL)
  /** text -> { domain: ids[] } */
  const tradeByText = new Map()
  for (const group of tradeStats.data.result ?? []) {
    const domain = String(group.label ?? '').toLowerCase()
    if (SKIP_DOMAINS.has(domain)) continue
    for (const entry of group.entries ?? []) {
      const text = normalize(entry.text ?? '')
      if (!text) continue
      let map = tradeByText.get(text)
      if (!map) { map = {}; tradeByText.set(text, map) }
      ;(map[domain] ??= []).push(entry.id)
    }
  }

  const statIds = []
  const statMatchers = []
  const newStats = []
  const aliases = []
  let textsKnown = 0
  let textsNotInPatch = 0
  for (const [text, domains] of tradeByText) {
    const ref = baseByText.get(text)
    if (ref) {
      textsKnown += 1
      const stat = baseByRef.get(ref)
      for (const [domain, ids] of Object.entries(domains)) {
        if (stat?.trade?.ids?.[domain]?.length) continue // upstream already has it
        statIds.push({ ref, domain, ids: [...new Set(ids)].sort() })
      }
      continue
    }
    // Same modifier, one filler word apart. 3.30 rewrote a handful of lines with
    // a redundant "to" (`+#% to Item Rarity`, printed on grafts) while the
    // skeleton still carries the old wording (`+#% Item Rarity`). Both are one
    // entry of the client's stat descriptions, so the trade ids belong on that
    // record - creating a second record with the same Chinese matcher would make
    // the match index ambiguous, because it has no grouping for this case.
    const aliasRef = findToVariant(text, baseByText)
    if (aliasRef) {
      aliases.push([text, aliasRef])
      const stat = baseByRef.get(aliasRef)
      for (const [domain, ids] of Object.entries(domains)) {
        if (stat?.trade?.ids?.[domain]?.length) continue
        statIds.push({ ref: aliasRef, domain, ids: [...new Set(ids)].sort() })
      }
      // the client can also print the new wording, so the record has to answer
      // to it - `+#` is what the index stores for a signed number
      statMatchers.push({ ref: aliasRef, string: text.replace(/\+#/g, '#') })
      continue
    }
    // No record at all: this is the line the app answers "unknown modifier" for.
    // Only accept it when the client can print it verbatim.
    if (!patchEn.has(text) && !patchEn.has(normalize(stripTags(text)))) { textsNotInPatch += 1; continue }
    const ids = {}
    for (const [domain, values] of Object.entries(domains)) ids[domain] = [...new Set(values)].sort()
    newStats.push({ ref: text, trade: { ids } })
  }
  statIds.sort((a, b) => (a.ref === b.ref ? a.domain.localeCompare(b.domain) : a.ref < b.ref ? -1 : 1))
  statMatchers.sort((a, b) => (a.ref === b.ref ? a.string.localeCompare(b.string) : a.ref < b.ref ? -1 : 1))
  newStats.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))

  const overlay = {
    meta: {
      note: 'Content the English skeleton does not ship yet, recovered from the ' +
        'official trade API. Additive only: `build-all` skips any entry the ' +
        'base data already has, and never takes Chinese from here. Regenerate ' +
        'with `node refresh-overlay.mjs`; deleting the file degrades to ' +
        'upstream-only. See lib/overlay.mjs.',
      generatedAt: new Date().toISOString(),
      patch: { version: patch.version, md5: patch.md5 },
      base: {
        items: sha256(enItemsRaw).slice(0, 16),
        stats: sha256(enStatsRaw).slice(0, 16)
      },
      sources: [
        { url: tradeItems.origin, counts: itemsByGroup },
        { url: tradeStats.origin, texts: tradeByText.size }
      ],
      groups: allGroups ? '(all)' : groups
    },
    items,
    statIds,
    statMatchers,
    stats: newStats
  }

  console.log(`base: ${baseItems.length} items, ${baseStats.length} stats`)
  console.log(`items added: ${items.length} ` + JSON.stringify(itemsByGroup))
  console.log(`trade texts: ${tradeByText.size} (${textsKnown} already known, ` +
    `${textsNotInPatch} not printable by this client)`)
  console.log(`trade ids filled in: ${statIds.length} (domains missing on an existing record)`)
  console.log(`stat records added: ${newStats.length}`)
  for (const [text, ref] of aliases) console.log(`  same modifier, new wording: ${text} -> ${ref}`)
  console.log(`overlay total: ${items.length + statIds.length + newStats.length} entries` +
    ` (${baseItemKeys.size} base item keys checked)`)

  if (dryRun) {
    console.log('--dry-run: nothing written')
    return
  }
  await writeFile(OVERLAY_PATH, JSON.stringify(overlay, null, 1) + '\n')
  console.log(`wrote ${path.relative(ROOT, OVERLAY_PATH)}`)
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => { console.error(err); process.exit(1) })
}
