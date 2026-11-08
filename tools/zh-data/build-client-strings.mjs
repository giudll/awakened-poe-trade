// Builds `renderer/public/data/zh_CN/client_strings.js`.
//
// `client_strings.js` is the vocabulary the item parser keys off: rarity names,
// `物品类别: `, `物品等级: `, socket/quality prefixes and so on. It is typed as
// `TranslationDict`, so its key set must match the English bundle exactly.
//
// The values must be *the text the game actually prints*, otherwise pasted items
// stop being recognised. So this script does not trust its seed: every Chinese
// value is looked up in the 编年史 patch (clientstrings, rarity, heist jobs, item
// classes, item types, words) and the ones that are not found verbatim are
// reported and fall back to English - which is also what the game shows when the
// localization has no wording for that line.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readPatchNames } from './lib/patch-names.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DATA = path.join(ROOT, 'renderer/public/data')
const SEED_PATH = path.join(__dirname, 'data/client_strings-cn.mjs')

/**
 * Labels whose seed wording was assembled from several strings, while the patch
 * carries the real template. `upto` takes the text before the first placeholder,
 * which is what the parser compares against (`(?<type>[^"]+)` in MODIFIER_LINE).
 */
const DERIVED = {
  // `ModDescriptionLineCraftedPrefix`: 大师工艺前缀 "{0}"
  CRAFTED_PREFIX: { id: 'ModDescriptionLineCraftedPrefix', upto: true },
  // `ModDescriptionLineCraftedSuffix`: 大师工艺后缀 "{0}"
  CRAFTED_SUFFIX: { id: 'ModDescriptionLineCraftedSuffix', upto: true },
  // `ItemPopupFoilUnique`: 烫金传奇  (the seed said 古藏传奇, which the game never prints)
  FOIL_UNIQUE: { id: 'ItemPopupFoilUnique' },
  // `ItemPopupUnmodifiable`: 不可改变  (the seed said 基底词缀不能改变)
  UNMODIFIABLE: { id: 'ItemPopupUnmodifiable' },
  // `MercenaryLevel`: 等级 {0}
  MERCENARY_LEVEL: { id: 'MercenaryLevel', upto: true }
}

const HAN = /[\u4e00-\u9fff]/

function shapeOf (value) {
  if (Array.isArray(value)) return 'array'
  if (value instanceof RegExp) return 'regex'
  return typeof value
}

function serialize (value) {
  if (Array.isArray(value)) return `[${value.map(serialize).join(', ')}]`
  if (value instanceof RegExp) return `/${value.source}/${value.flags}`
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** Derives the label from a patch template (`等级 {0}` -> `等级` + trailing space). */
export function deriveLabel (template, { upto = false } = {}) {
  if (!template) return null
  const plain = template.replace(/<[^>]+>/g, '')
  if (!upto) return plain.trim()
  const cut = plain.search(/\{/)
  const head = (cut === -1 ? plain : plain.slice(0, cut)).replace(/["'“”]+$/, '')
  return head.trimEnd() + (plain[cut - 1] === ' ' ? ' ' : '')
}

/** Is this Chinese string something the patch prints? */
export function verifyLabel (value, vocabulary) {
  const body = value.replace(/:\s*$/, '').trim()
  if (!body) return true // punctuation only, nothing to verify
  const candidates = [body, value.trim(), body.replace(/\s+/g, '')]
  if (candidates.some(c => vocabulary.has(c))) return true
  // Compound labels such as `破碎的 前缀属性` are two templates glued together.
  const tokens = body.split(/\s+/).filter(Boolean)
  return tokens.length > 1 && tokens.every(t => vocabulary.has(t) || vocabulary.has(t.replace(/\s+/g, '')))
}

export async function buildClientStrings ({ zipBuffer, quiet = false } = {}) {
  const en = (await import(pathToFileURL(path.join(DATA, 'en/client_strings.js')).href)).default
  const seed = (await import(pathToFileURL(SEED_PATH).href)).default
  const patch = zipBuffer ? readPatchNames(zipBuffer) : null

  const report = {
    keys: 0,
    translated: 0,
    derived: [],
    unverified: [],
    keptEnglish: [],
    shapeMismatch: [],
    ignoredSeedKeys: []
  }
  const lines = []

  for (const [key, enValue] of Object.entries(en)) {
    report.keys += 1
    let value = Object.hasOwn(seed, key) ? seed[key] : undefined
    let derived = false

    // The wording comes from the patch whenever the patch has a template for it.
    if (patch && DERIVED[key]) {
      const derivedValue = deriveLabel(patch.clientStrings.get(DERIVED[key].id), DERIVED[key])
      if (derivedValue) {
        value = derivedValue
        derived = true
        report.derived.push({ key, id: DERIVED[key].id, value: derivedValue })
      }
    }

    let useSeed = value !== undefined && value !== null && value !== ''

    // The value has to keep the English shape (`RegExp` stays a RegExp, arrays
    // stay arrays), otherwise the typed consumer breaks. A regex has to stay a
    // regex as well because the parser calls `.exec()` on it.
    if (useSeed && shapeOf(value) !== shapeOf(enValue)) {
      report.shapeMismatch.push(key)
      useSeed = false
    }

    if (useSeed && patch && typeof value === 'string' && HAN.test(value) && !derived) {
      if (!verifyLabel(value, patch.vocabulary)) {
        report.unverified.push({ key, value })
        useSeed = false
      }
    }

    if (useSeed) report.translated += 1
    else report.keptEnglish.push(key)

    lines.push(`  ${key}: ${serialize(useSeed ? value : enValue)}`)
  }

  report.ignoredSeedKeys = Object.keys(seed).filter(key => !Object.hasOwn(en, key))

  const out = `// @ts-check
/** @type{import('../../../src/assets/data/interfaces').TranslationDict} */
export default {
${lines.join(',\n')}
}
`

  if (!quiet) {
    console.log(`client_strings: ${report.translated}/${report.keys} translated` +
      (report.derived.length ? `, ${report.derived.length} from patch templates` : ''))
    if (report.unverified.length) {
      console.log(`  ! not found in 编年史, kept English:`)
      report.unverified.forEach(u => console.log(`      ${u.key} = ${JSON.stringify(u.value)}`))
    }
    if (report.keptEnglish.length) {
      console.log(`  kept English: ${report.keptEnglish.join(', ')}`)
    }
    if (report.ignoredSeedKeys.length) {
      console.log(`  ! seed keys unknown to this version: ${report.ignoredSeedKeys.join(', ')}`)
    }
  }

  return { text: out, report }
}

async function main () {
  const localZip = process.argv.find(a => a.startsWith('--zip='))?.slice(6)
  let zipBuffer
  if (localZip) {
    const { getPatchZip } = await import('./lib/patch.mjs')
    zipBuffer = (await getPatchZip({ localZip })).buffer
  }
  const { text, report } = await buildClientStrings({ zipBuffer })
  const outPath = path.join(DATA, 'zh_CN/client_strings.js')
  await writeFile(outPath, text)
  console.log(`wrote ${outPath}`)
  await writeFile(path.join(__dirname, 'out-client-strings-report.json'), JSON.stringify(report, null, 2))
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => { console.error(err); process.exit(1) })
}
