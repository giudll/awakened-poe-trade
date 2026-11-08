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
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPatchZip } from './lib/patch.mjs'
import { buildStats } from './build-stats.mjs'
import { buildItems } from './build-items.mjs'
import { buildClientStrings } from './build-client-strings.mjs'

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
  const coverage = {
    realMods: stats.report.realMods.translated / stats.report.realMods.total,
    itemNames: items.report.translated / items.report.records,
    uniqueNames: uniqueNames ? uniqueNames.translated / uniqueNames.total : 0,
    labels: strings.report.translated / strings.report.keys
  }

  const failures = Object.entries(GATES)
    .filter(([key, min]) => coverage[key] < min)
    .map(([key, min]) => `${key}: ${(coverage[key] * 100).toFixed(1)}% < ${(min * 100).toFixed(0)}%`)

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
  if (failures.length) console.log(`  ! ${failures.join('; ')}`)

  return { coverage, failures, stats: stats.report, items: items.report, strings: strings.report }
}

async function main () {
  const localZip = process.argv.find(a => a.startsWith('--zip='))?.slice(6)
  const checkOnly = process.argv.includes('--check')

  const patch = await getPatchZip({ localZip })
  console.log(`patch: version=${patch.version} md5=${patch.md5 || '(unknown)'} ` +
    `size=${(patch.buffer.length / 1048576).toFixed(1)}MB from ${patch.source}`)

  const result = await buildAll({ zipBuffer: patch.buffer, checkOnly })

  if (!checkOnly) {
    const lock = {
      version: patch.version,
      md5: patch.md5,
      builtAt: new Date().toISOString(),
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
