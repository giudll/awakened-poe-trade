// The "new content" overlay: a cache of records that the English skeleton
// (`renderer/public/data/en/`) does not contain *yet*.
//
// Why it exists
// -------------
// `en/` is a snapshot of SnosMe's build. Between two of his releases a league
// starts and the game already shows items and modifiers that the snapshot has
// never heard of, so the price check answers "unknown item" or silently drops
// every modifier (see `Parser.ts`, `stat-translations.ts`). The trade site
// knows about them on day one, because it is the same game data - so they can
// be recovered from `https://www.pathofexile.com/api/trade/data/{items,stats}`.
//
// Why it cannot drift
// -------------------
// The overlay is *additive only*, and the merge below enforces that on every
// build:
//
//   * a record that the base data already has is never touched - the overlay
//     entry is counted as `superseded` and skipped, so the moment upstream
//     refreshes `en/`, the output is upstream's version again;
//   * a trade id domain that the base record already has is never touched -
//     only a missing domain is filled in;
//   * nothing here can introduce Chinese: `build-items` / `build-stats` still
//     resolve every name and every matcher out of the 编年史 patch, so when
//     编年史 translates new content its text wins automatically.
//
// `new-content.json` is therefore disposable - it is a cache with a
// fingerprint of the base it was computed against, regenerated wholesale by
// `refresh-overlay.mjs`. Deleting it degrades to "upstream only", it never
// corrupts anything.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const OVERLAY_PATH = path.join(__dirname, '../data/new-content.json')

/** @typedef {{ namespace: string, refName: string, group?: string }} OverlayItem */
/** @typedef {{ ref: string, domain: string, ids: string[] }} OverlayStatId */
/** @typedef {{ ref: string, trade: { ids: Record<string, string[]> } }} OverlayStat */

/**
 * @typedef {object} Overlay
 * @property {object} meta
 * @property {OverlayItem[]} items
 * @property {OverlayStatId[]} statIds
 * @property {OverlayStat[]} stats
 */

const EMPTY = { meta: {}, items: [], statIds: [], stats: [] }

/** @returns {Promise<Overlay>} */
export async function readOverlay (file = OVERLAY_PATH) {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'))
    return {
      meta: raw.meta ?? {},
      items: Array.isArray(raw.items) ? raw.items : [],
      statIds: Array.isArray(raw.statIds) ? raw.statIds : [],
      stats: Array.isArray(raw.stats) ? raw.stats : []
    }
  } catch (err) {
    if (err.code === 'ENOENT') return { ...EMPTY }
    throw err
  }
}

const itemKey = (item) => `${item.namespace}::${item.refName}`

/**
 * Appends the overlay's item records to the base list.
 *
 * The added records carry `name === refName`, i.e. English, exactly like any
 * other item the patch has not translated - `build-items` then runs its normal
 * resolution over them and picks up the Chinese name for free once 编年史 has
 * one.
 *
 * @param {any[]} baseItems records from `en/items.ndjson`
 * @param {Overlay} overlay
 */
export function mergeItems (baseItems, overlay) {
  const seen = new Set(baseItems.map(itemKey))
  const added = []
  let superseded = 0

  for (const entry of overlay.items) {
    if (!entry?.namespace || !entry?.refName) continue
    const key = itemKey(entry)
    if (seen.has(key)) { superseded += 1; continue }
    seen.add(key)
    added.push({ name: entry.refName, refName: entry.refName, namespace: entry.namespace })
  }

  return { items: [...baseItems, ...added], added: added.length, superseded }
}

const flattenStats = (rec) => ('stats' in rec ? rec.stats : [rec])

/**
 * Fills in trade stat ids and appends stat records the skeleton lacks.
 *
 * `statIds` entries only ever fill a *missing* domain of an existing record: if
 * upstream already maps `implicit` for that line, upstream's ids stay and the
 * overlay entry is counted as `superseded`. This is what makes an upstream
 * refresh converge instead of conflict.
 *
 * New records are created with `better: NotComparable`. The trade API does not
 * publish which direction is "better" and guessing from `reduced` / `less` is
 * wrong about as often as it is right ("reduced Damage taken" gets better as the
 * number grows), so those modifiers are searchable but do not get an automatic
 * min/max filter. Upstream's own data does carry the flag, so as soon as the
 * record exists there it comes back.
 *
 * @param {any[]} baseRecords records from `en/stats.ndjson`
 * @param {Overlay} overlay
 */
export function mergeStats (baseRecords, overlay) {
  /** @type {Map<string, any>} */
  const byRef = new Map()
  for (const rec of baseRecords) {
    for (const stat of flattenStats(rec)) if (!byRef.has(stat.ref)) byRef.set(stat.ref, stat)
  }

  let domainsAdded = 0
  let domainsKept = 0
  for (const entry of overlay.statIds) {
    if (!entry?.ref || !entry?.domain || !entry.ids?.length) continue
    const stat = byRef.get(entry.ref)
    if (!stat) continue // its record is added by `stats` below, ids included
    if (!stat.trade) stat.trade = { ids: {} }
    if (!stat.trade.ids) stat.trade.ids = {}
    if (stat.trade.ids[entry.domain]?.length) { domainsKept += 1; continue }
    stat.trade.ids[entry.domain] = [...entry.ids]
    domainsAdded += 1
  }

  const out = [...baseRecords]
  /** @type {Set<string>} */
  const addedRefs = new Set()
  let added = 0
  let superseded = 0
  for (const entry of overlay.stats) {
    if (!entry?.ref || !entry?.trade?.ids) continue
    if (byRef.has(entry.ref)) { superseded += 1; continue }
    const stat = {
      ref: entry.ref,
      matchers: [{ string: entry.ref }],
      better: 0,
      trade: { ids: entry.trade.ids }
    }
    out.push(stat)
    byRef.set(entry.ref, stat)
    addedRefs.add(entry.ref)
    added += 1
  }

  return {
    records: out,
    report: { added, superseded, domainsAdded, domainsKept },
    addedRefs
  }
}
