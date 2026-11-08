// Everything the patch knows about *names*.
//
// The patch only replaces `.datc64` files of one language slot, and every table
// keeps the language independent Id next to the text column, so the names are
// byte identical with what the game shows:
//
//   baseitemtypes.datc64       Id (Metadata/Items/...) + name  -> base types, gems, cards, maps
//   words.datc64               English word + Chinese word     -> unique names, magic name parts
//   itemclasses.datc64         Id + name                       -> item class ("双手斧")
//   itemclasscategories.datc64 Id + name                       -> item class category ("单手锤")
//   clientstrings.datc64       Id + text                       -> every UI label ("物品类别")
//   rarity.datc64              Id + name                       -> "普通" / "魔法" / "稀有" / "传奇"
//   heistjobs.datc64           Id + name                       -> "解密术" / "凶蛮之力" ...
//   activeskills.datc64        key + name                      -> skill names, incl. transfigured gems
//
// Two consequences matter downstream:
//
//   * unique names come from `words`, where one row holds the English *and* the
//     Chinese name, so the pairing is exact - no fuzzy matching anywhere;
//   * every Chinese string the app will ever display can be traced back to one
//     of these tables. `vocabulary` is what the other build steps use to reject
//     text that did not come from the 编年史 localization.
import { listZipEntries, readZipEntry } from './zip.mjs'
import { readDatc64, stringAt, readIdNameColumns, detectStringColumns } from './datc64.mjs'

const DIR = 'data/traditional chinese/'

const HAN = /[\u4e00-\u9fff]/
// Hangul, private use, replacement chars: only appear when a pointer is read one
// byte off, so they mark a bogus column.
const GARBAGE = /[\uac00-\ud7af\ue000-\uf8ff\ufffd]/
const ASCII = /^[\x20-\x7e]+$/

function findEntry (entries, base) {
  return entries.find(e => e.name.toLowerCase() === DIR + base)
}

/** Normalized form used to line an Id up with an English name. */
export function normId (s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** `words`: locate the English word / Chinese word columns. */
function readWords (dat) {
  if (!dat) return new Map()
  const cols = detectStringColumns(dat)
  const isAscii = (offset) => {
    const n = Math.min(dat.rowCount, 200)
    let hits = 0
    for (let r = 0; r < n; r++) {
      const s = stringAt(dat, r, offset)
      if (typeof s === 'string' && s.length > 0 && ASCII.test(s)) hits++
    }
    return hits / n
  }
  const enCol = cols.find(c => isAscii(c.offset) > 0.9)
  if (!enCol) throw new Error('words.datc64: English column not found')
  const zhCol = cols.find(c => c.offset > enCol.offset && c.emptyRate < 0.3 && c.distinct > 50)
  if (!zhCol) throw new Error('words.datc64: localized column not found')

  const pairs = new Map()
  for (let r = 0; r < dat.rowCount; r++) {
    const en = stringAt(dat, r, enCol.offset)?.trim()
    const zh = stringAt(dat, r, zhCol.offset)?.trim()
    if (en && zh && en !== zh) pairs.set(en, zh)
  }
  return pairs
}

/**
 * Finds the (identifier, text) pair of a plain table.
 *
 * `clientstrings` keeps its text one field *before* the offsets the generic
 * detector accepts, so the columns are located by content instead: the id column
 * is the first one that is all ASCII, the text column the first one after it
 * that is mostly Han and free of pointer garbage.
 */
export function readIdTextTable (dat) {
  const offsets = []
  for (let o = 0; o + 4 <= dat.rowLength; o += 4) offsets.push(o)

  const stats = offsets.map((offset) => {
    let filled = 0; let han = 0; let ascii = 0; let garbage = 0
    const n = Math.min(dat.rowCount, 400)
    const values = []
    for (let r = 0; r < n; r++) {
      let s
      try { s = stringAt(dat, r, offset) } catch { continue }
      if (typeof s !== 'string' || s === '') continue
      filled += 1
      values.push(s)
      if (HAN.test(s)) han += 1
      if (ASCII.test(s)) ascii += 1
      if (GARBAGE.test(s)) garbage += 1
    }
    return { offset, filled, han, ascii, garbage, values, n }
  })

  const idCol = stats.find(c => c.filled / c.n > 0.8 && c.ascii / c.filled > 0.9 && c.garbage === 0)
  if (!idCol) return { rows: [] }
  const textCol = stats.find(c => c.offset > idCol.offset && c.filled > 0 &&
    c.garbage === 0 && c.han / c.filled > 0.5)
  if (!textCol) return { rows: [] }

  const rows = []
  for (let r = 0; r < dat.rowCount; r++) {
    const id = stringAt(dat, r, idCol.offset)?.trim()
    const text = stringAt(dat, r, textCol.offset)?.trim()
    if (id && text) rows.push({ id, text })
  }
  return { rows, idOffset: idCol.offset, textOffset: textCol.offset }
}

/** Strips `<tag>` markup, placeholders and quotes so a label can be compared. */
function templateLiterals (text) {
  // Rich text wraps values in braces (`{<rgb(...)>{ — 数值不可调整}}`), while
  // placeholders look like `{0}` / `{1:+d}`. Only the latter are removed; the
  // former keep their content and lose the braces. Braces nest, so peel a few
  // layers before giving up.
  let plain = text.replace(/<[^>]+>/g, '')
  for (let pass = 0; pass < 3; pass++) {
    const before = plain
    plain = plain.replace(/\{([^{}]*)\}/g, (all, inner) => (/[^\d\s%+.:\-/]/.test(inner) ? inner : '\u0000'))
    if (plain === before) break
  }
  plain = plain.replace(/[{}"]/g, ' ')

  const out = new Set()
  for (const part of plain.split('\u0000')) {
    const trimmed = part.trim()
    if (trimmed) out.add(trimmed)
  }
  const whole = plain.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim()
  if (whole) out.add(whole)
  return out
}

/**
 * @param {Buffer} zipBuffer
 * @returns {{
 *   words: Map<string, string>,
 *   baseTypes: {id: string, name: string}[],
 *   baseTypeNames: Set<string>,
 *   baseTypeByNormId: Map<string, {id: string, name: string}[]>,
 *   itemClasses: Map<string, string>,
 *   itemClassCategories: Map<string, string>,
 *   clientStrings: Map<string, string>,
 *   skillNames: Set<string>,
 *   heistJobs: Map<string, string>,
 *   rarity: Map<string, string>,
 *   vocabulary: Set<string>
 * }}
 */
export function readPatchNames (zipBuffer) {
  const entries = listZipEntries(zipBuffer)
  const read = (base, { optional = false } = {}) => {
    const entry = findEntry(entries, base)
    if (!entry) {
      if (optional) return null
      throw new Error(`patch: ${base} is missing`)
    }
    return readDatc64(readZipEntry(zipBuffer, entry))
  }

  const bt = readIdNameColumns(read('baseitemtypes.datc64'))
  if (!bt) throw new Error('baseitemtypes.datc64: Id/Name columns not found')
  const baseTypes = bt.rows
    .map(r => ({ id: r.id?.trim(), name: r.name?.trim() }))
    .filter(r => r.id && r.name)

  // Ids end in a CamelCase identifier that usually contains the English name but
  // often adds a prefix (`SkillGemAbsolution`, `DivinationCardAssassinsFavour`),
  // so every suffix of the identifier is indexed. Short suffixes are skipped to
  // keep `Map` or `Chaos` from matching half the table.
  const MIN_ID_SUFFIX = 8
  const baseTypeByNormId = new Map()
  const index = (key, row) => {
    let rows = baseTypeByNormId.get(key)
    if (!rows) baseTypeByNormId.set(key, (rows = []))
    if (!rows.includes(row)) rows.push(row)
  }
  for (const row of baseTypes) {
    const segment = normId(row.id.split('/').pop())
    for (let i = 0; i + MIN_ID_SUFFIX <= segment.length; i++) index(segment.slice(i), row)
  }

  const itemClasses = new Map()
  {
    const pair = readIdNameColumns(read('itemclasses.datc64'), {
      idPattern: /^[A-Za-z][\w' ]*$/, fallbackToFirstPair: true
    })
    for (const r of pair?.rows ?? []) if (r.id && r.name) itemClasses.set(r.id.trim(), r.name.trim())
  }

  const itemClassCategories = new Map()
  {
    const pair = readIdNameColumns(read('itemclasscategories.datc64'), {
      idPattern: /^[A-Za-z][\w' ]*$/, fallbackToFirstPair: true
    })
    for (const r of pair?.rows ?? []) if (r.id && r.name) itemClassCategories.set(r.id.trim(), r.name.trim())
  }

  const words = readWords(read('words.datc64'))

  const clientStrings = new Map()
  for (const row of readIdTextTable(read('clientstrings.datc64')).rows) clientStrings.set(row.id, row.text)

  const rarity = new Map()
  for (const row of readIdTextTable(read('rarity.datc64')).rows) rarity.set(row.id, row.text)

  const heistJobs = new Map()
  for (const row of readIdTextTable(read('heistjobs.datc64')).rows) heistJobs.set(row.id, row.text)

  const skillNames = new Set()
  for (const row of readIdTextTable(read('activeskills.datc64')).rows) skillNames.add(row.text)

  // Area names live in their own table (`1_1_town` -> `狮眼守望`), and the item
  // parser looks them up by the English area name. Chart (海图) areas are in
  // `deepwaterrooms` instead - their Ids (`SandyEnd1`) say nothing about the
  // English name, so those can only be matched by the name itself.
  const worldAreas = readIdTextTable(read('worldareas.datc64', { optional: true })).rows
  const deepwaterRooms = readIdTextTable(read('deepwaterrooms.datc64', { optional: true })).rows
  const areaNames = new Set([...worldAreas, ...deepwaterRooms].map(r => r.text))
  const areaByNormId = new Map()
  for (const row of worldAreas) {
    const segment = normId(row.id.replace(/^.*\//, ''))
    for (let i = 0; i + 4 <= segment.length; i++) {
      const key = segment.slice(i)
      if (!areaByNormId.has(key)) areaByNormId.set(key, [])
      if (!areaByNormId.get(key).includes(row.text)) areaByNormId.get(key).push(row.text)
    }
  }

  const vocabulary = new Set()
  const add = (text) => {
    if (!text) return
    for (const literal of templateLiterals(text)) {
      vocabulary.add(literal)
      vocabulary.add(literal.replace(/\s+/g, ''))
    }
  }
  for (const text of clientStrings.values()) add(text)
  for (const [id, text] of rarity) { add(id); add(text) }
  for (const text of heistJobs.values()) add(text)
  for (const text of itemClasses.values()) add(text)
  for (const text of itemClassCategories.values()) add(text)
  for (const text of baseTypes.map(r => r.name)) add(text)
  for (const text of words.values()) add(text)

  return {
    words,
    baseTypes,
    baseTypeNames: new Set(baseTypes.map(r => r.name)),
    baseTypeByNormId,
    itemClasses,
    itemClassCategories,
    clientStrings,
    skillNames,
    worldAreas,
    areaNames,
    areaByNormId,
    heistJobs,
    rarity,
    vocabulary
  }
}
