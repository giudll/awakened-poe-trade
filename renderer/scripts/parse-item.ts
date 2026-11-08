// Offline parser check: feeds item text (from --file or stdin) through the real
// parser against the checked-in data bundle, without starting Electron.
//
//   npm run parse:item -- --lang=zh_CN --file=./tmp/item.txt
import { readFile } from 'fs/promises'
import { initForNode } from '../src/assets/data/node'
import { parseClipboard, ParsedItem } from '../src/parser'

interface CliOptions {
  lang: string
  file?: string
  dataDir?: string
  verbose: boolean
  /** Fail when an item has more unrecognized modifier lines than this. */
  maxUnknown: number | null
}

function parseArgs (argv: string[]): CliOptions {
  const options: CliOptions = { lang: 'zh_CN', verbose: false, maxUnknown: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--lang') {
      options.lang = argv[i + 1]; i += 1
    } else if (arg.startsWith('--lang=')) {
      options.lang = arg.slice(7)
    } else if (arg === '--file') {
      options.file = argv[i + 1]; i += 1
    } else if (arg.startsWith('--file=')) {
      options.file = arg.slice(7)
    } else if (arg === '--data-dir') {
      options.dataDir = argv[i + 1]; i += 1
    } else if (arg.startsWith('--data-dir=')) {
      options.dataDir = arg.slice(11)
    } else if (arg === '--verbose') {
      options.verbose = true
    } else if (arg.startsWith('--max-unknown=')) {
      options.maxUnknown = Number(arg.slice(14))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function readStdin () {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', chunk => chunks.push(Buffer.from(chunk)))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

function summarize (item: ParsedItem, verbose: boolean) {
  const stats = item.statsByType.map((calc) => {
    const type = calc.type
    const tradeIds = calc.stat.trade.ids[type] ?? []
    const tier = calc.sources.map(s => s.modifier.info.tier).find(t => t != null)
    return {
      type,
      ref: calc.stat.ref,
      // what actually goes to the trade site: language independent stat ids
      tradeIds,
      tier,
      roll: calc.sources[0]?.contributes?.value,
      text: calc.sources[0]?.stat.translation.string
    }
  })

  return {
    itemClass: item.category,
    rarity: item.rarity,
    name: item.info.name,
    refName: item.info.refName,
    baseType: item.uniqueBase?.name,
    stackSize: item.stackSize?.value,
    modCount: stats.length,
    stats: verbose
      ? stats
      : stats.map(s => (s.tradeIds[0] ? `${s.ref} -> ${s.tradeIds[0]}` : s.ref)),
    unknownModifiers: item.unknownModifiers
  }
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  await initForNode(options.lang, { dataDir: options.dataDir })

  const text = (options.file
    ? await readFile(options.file, 'utf8')
    : await readStdin()).replace(/\r\n/g, '\n')

  // Item text may contain several items separated by a long dash line.
  const items = text.split(/\n-{20,}\n/).map(t => t.trim()).filter(Boolean)
  const results = []

  for (const [index, chunk] of items.entries()) {
    const parsed = parseClipboard(chunk)
    if (parsed.isErr()) {
      results.push({ index, error: parsed.error })
      continue
    }
    results.push({ index, ...summarize(parsed.value, options.verbose) })
  }

  console.log(JSON.stringify(results, null, 2))

  const failed = results.filter(r => 'error' in r)
  const tooManyUnknown = options.maxUnknown === null ? [] : results.filter(r =>
    'unknownModifiers' in r && r.unknownModifiers.length > options.maxUnknown!)

  if (failed.length) console.error(`${failed.length}/${results.length} items failed to parse`)
  if (tooManyUnknown.length) {
    console.error(`${tooManyUnknown.length}/${results.length} items exceed --max-unknown=${options.maxUnknown}`)
  }
  if (failed.length || tooManyUnknown.length) process.exitCode = 1
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
