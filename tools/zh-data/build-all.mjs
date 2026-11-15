// Rebuilds the whole `renderer/public/data/zh_CN/` bundle from the 编年史 patch.
//
//   node build-all.mjs --zip=/path/to/<md5>.zip        # offline, from a local zip
//   node build-all.mjs                                 # fetches pin_cn.json + the zip
//   node build-all.mjs --check                         # only verify the coverage gates
//
// Outputs (all generated, all committed):
//   stats.ndjson         English records + Simplified Chinese matcher strings
//   items.ndjson         Chinese display names, English refNames
//   client_strings.js    parser vocabulary (rarity, "物品类别: ", ...)
//   zh-data.lock.json    what was built from which patch (used by the daily probe)
//
// `app_i18n.json` (the app's own UI translation) is not generated: it is not part
// of the game data, it is a hand-maintained translation committed next to it.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPatchZip } from './lib/patch.mjs'
import { buildStats } from './build-stats.mjs'
import { buildItems } from './build-items.mjs'
import { buildClientStrings } from './build-client-strings.mjs'
import { inputsFingerprint } from './inputs-hash.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DATA = path.join(ROOT, 'renderer/public/data')
const LOCK_PATH = path.join(__dirname, 'zh-data.lock.json')

// Below these the localization is considered broken, not merely incomplete.
const GATES = {
  realMods: 0.85,
  itemNames: 0.90,
  uniqueNames: 0.95,
  labels: 0.98
}

export async function buildAll ({ zipBuffer, checkOnly = false }) {
  const stats = await buildStats({ zipBuffer, quiet: checkOnly })
  const items = await buildItems({ zipBuffer, quiet: checkOnly })
  const strings = await buildClientStrings({ zipBuffer, quiet: checkOnly })

  const uniqueNames = items.report.byNamespace.UNIQUE
  const rm = stats.report.realMods
  const coverage = {
    // Gated on the lines this patch still contains: the English skeleton keeps
    // records for stats a balance patch removed, and those can never show up on
    // an item again. The raw number is recorded next to it, not thrown away.
    realMods: rm.currentTranslated / rm.current,
    itemNames: items.report.translated / items.report.records,
    uniqueNames: uniqueNames ? uniqueNames.translated / uniqueNames.total : 0,
    labels: strings.report.translated / strings.report.keys
  }
  const informational = {
    realModsRaw: rm.translated / rm.total,
    staleLines: `${rm.stale}/${rm.total}`
  }

  // What the additive overlay contributed, and how much of it upstream has
  // caught up with. `superseded > 0` simply means `data/new-content.json` can be
  // pruned by re-running `refresh-overlay.mjs`; the emitted data is already
  // upstream's, because the merge never overwrites a base record.
  const overlay = {
    items: items.report.overlay,
    stats: stats.report.overlay.stats,
    statIds: stats.report.overlay.statIds
  }

  const failures = Object.entries(GATES)
    .filter(([key, min]) => coverage[key] < min)
    .map(([key, min]) => `${key}: ${(coverage[key] * 100).toFixed(1)}% < ${(min * 100).toFixed(0)}%`)

  // The gate above only counts lines the patch still contains, so a bug in that
  // filter would quietly turn into a perfect score. Refuse to trust it when it
  // classifies an implausible share of the bundle as deleted.
  const staleShare = rm.stale / rm.total
  if (!(rm.current > 0) || staleShare > 0.3) {
    failures.push(`stale detection looks wrong: ${rm.stale}/${rm.total} records not found in the patch`)
  }

  if (!checkOnly) {
    // `*.index.bin` are not written here: the renderer build regenerates them
    // from the ndjson files (see `vite-plugin-make-indexes.ts`).
    await writeFile(path.join(DATA, 'zh_CN/stats.ndjson'), stats.ndjson)
    await writeFile(path.join(DATA, 'zh_CN/items.ndjson'), items.ndjson)
    await writeFile(path.join(DATA, 'zh_CN/client_strings.js'), strings.text)
  }

  console.log('coverage:')
  for (const [key, value] of Object.entries(coverage)) {
    const mark = value >= GATES[key] ? 'ok  ' : 'FAIL'
    console.log(`  ${mark} ${key.padEnd(14)} ${(value * 100).toFixed(1)}% (gate ${(GATES[key] * 100).toFixed(0)}%)`)
  }
  console.log(`  info realModsRaw     ${(informational.realModsRaw * 100).toFixed(1)}% ` +
    `(all records, incl. ${informational.staleLines} lines deleted by this version)`)
  console.log(`  info overlay         +${overlay.items.added} items, ` +
    `+${overlay.stats.added} stat records, +${overlay.statIds.added} trade id domains`)
  if (overlay.items.superseded || overlay.stats.superseded) {
    console.log(`  info overlay stale   ${overlay.items.superseded} items / ` +
      `${overlay.stats.superseded} stats are upstream now - run refresh-overlay.mjs to prune`)
  }
  if (failures.length) console.log(`  ! ${failures.join('; ')}`)

  return {
    coverage,
    informational,
    overlay,
    failures,
    stats: stats.report,
    items: items.report,
    strings: strings.report
  }
}

async function main () {
  const localZip = process.argv.find(a => a.startsWith('--zip='))?.slice(6)
  const checkOnly = process.argv.includes('--check')
  // A local zip carries no version string, so a build from one would otherwise
  // stamp `version: "unknown"` into the committed lock. Only needed when
  // reproducing a CI run offline.
  const versionArg = process.argv.find(a => a.startsWith('--version='))?.slice(10)

  const patch = await getPatchZip({ localZip })
  if (versionArg) patch.version = versionArg
  console.log(`patch: version=${patch.version} md5=${patch.md5 || '(unknown)'} ` +
    `size=${(patch.buffer.length / 1048576).toFixed(1)}MB from ${patch.source}`)

  const result = await buildAll({ zipBuffer: patch.buffer, checkOnly })

  // A zip on disk carries no version string, and `zh-cn.yml` numbers the release
  // after the patch version: stamping "unknown" would push the build out of the
  // 3.30.x series. When the patch is byte-identical to the one the committed lock
  // describes, that lock already knows the version.
  if (!checkOnly && patch.version === 'unknown') {
    const previous = await readFile(LOCK_PATH, 'utf8').then(JSON.parse).catch(() => null)
    if (previous?.md5 === patch.md5 && previous.version && previous.version !== 'unknown') {
      patch.version = previous.version
    }
  }

  if (!checkOnly) {
    const lock = {
      version: patch.version,
      md5: patch.md5,
      builtAt: new Date().toISOString(),
      // Which slot the Chinese came out of, and the raw (unfiltered) coverage:
      // both are what tells a future maintainer whether a drop is real.
      zhSlot: result.stats.zhSlot.used,
      realModsRaw: Number(result.informational.realModsRaw.toFixed(4)),
      staleLines: result.informational.staleLines,
      // Additive overlay: how much came from the trade API, and how much of it
      // upstream has caught up with since. Both zero means the skeleton covers
      // everything again and the overlay file can be emptied.
      overlay: {
        items: result.overlay.items.added,
        statRecords: result.overlay.stats.added,
        statIdDomains: result.overlay.statIds.added,
        superseded: result.overlay.items.superseded + result.overlay.stats.superseded
      },
      // What this build consumed besides the patch. `zh-data.yml` rebuilds when
      // it changes, so the bundle can never sit on an older English skeleton
      // after an upstream sync.
      inputs: await inputsFingerprint(),
      coverage: Object.fromEntries(Object.entries(result.coverage)
        .map(([key, value]) => [key, Number(value.toFixed(4))]))
    }
    await writeFile(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n')
    console.log(`wrote ${path.relative(ROOT, LOCK_PATH)}`)
  }

  if (result.failures.length) process.exitCode = 1
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => { console.error(err); process.exit(1) })
}
