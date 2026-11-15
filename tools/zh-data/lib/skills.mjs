// "Grants Level N <skill>" lines, i.e. the mods that hand you a skill instead of
// a number.
//
// The client does not format those from `Metadata/StatDescriptions` like a
// normal mod. When the patch has no description for the stat it falls back to
// the `ModGrantsEffectWithLevel` ClientString, which is
//
//   Grants Level {1} {0}      -- {1} = level, {0} = the skill's *localised* name
//
// and `{0}` comes from `Data/<lang>/ActiveSkills.datc64`. That is why Hyrri's
// Truth prints a half-English line on a Chinese client:
//
//   Grants Level 30 精准
//
// The English half is the untranslated ClientString, the Chinese half is the
// localised skill name. No matcher built from the trade site can ever match it
// (`Grants Level # Precision Skill` has a different wording and an extra word),
// so those mods have to be rebuilt from the two pieces the client actually
// concatenates. Reading the template from the patch instead of hardcoding
// "Grants Level" means the bundle follows the patch if it ever gets translated
// ("获得 {1} 级{0}") without a code change.
import { listZipEntries, readZipEntry } from './zip.mjs'
import { readDatc64, detectStringColumns, stringAt } from './datc64.mjs'

const LANG_DIR = 'data/traditional chinese/'

/** The ClientString that turns "skill + level" into a line of item text. */
export const GRANTS_LINE_KEY = 'ModGrantsEffectWithLevel'

/** Fallback when the patch ships a ClientStrings table without that row. */
export const FALLBACK_GRANTS_TEMPLATE = 'Grants Level {1} {0}'

const CJK = /[\u4e00-\u9fff]/
const SNAKE_ID = /^[A-Za-z0-9_]+$/

function findEntry (zipBuffer, name) {
  return listZipEntries(zipBuffer).find(e => e.name.toLowerCase() === (LANG_DIR + name).toLowerCase())
}

function cjkRatio (dat, offset, limit = 400) {
  let seen = 0
  let cjk = 0
  for (let r = 0; r < dat.rowCount && seen < limit; r += 1) {
    const s = stringAt(dat, r, offset)
    if (typeof s !== 'string' || s === '') continue
    seen += 1
    if (CJK.test(s)) cjk += 1
  }
  return seen ? cjk / seen : 0
}

function meanLength (dat, offset, limit = 400) {
  let seen = 0
  let total = 0
  for (let r = 0; r < dat.rowCount && seen < limit; r += 1) {
    const s = stringAt(dat, r, offset)
    if (typeof s !== 'string' || s === '') continue
    seen += 1
    total += s.length
  }
  return seen ? total / seen : Infinity
}

/** Reads one ClientStrings row by its key. Returns `null` when the key is absent. */
export function readClientString (dat, key) {
  let keyOffset = -1
  let row = -1
  for (let offset = 0; offset + 4 <= dat.rowLength; offset += 4) {
    for (let r = 0; r < dat.rowCount; r += 1) {
      if (stringAt(dat, r, offset) === key) {
        keyOffset = offset
        row = r
        break
      }
    }
    if (row !== -1) break
  }
  if (row === -1) return null

  // The value sits in the first string column after the key that has text on
  // this row. Columns in between are usually empty for this table, so probing
  // by row is more reliable than guessing from the column layout.
  for (let offset = 0; offset + 4 <= dat.rowLength; offset += 4) {
    if (offset === keyOffset) continue
    const s = stringAt(dat, row, offset)
    if (typeof s === 'string' && s !== '' && s !== key) return s
  }
  return null
}

/**
 * Localised names of the game's active skills, keyed by a normalised id.
 *
 * `Precision` (the name the trade data uses) -> `precision` (the id the game
 * uses) -> `精准`.
 */
export function readActiveSkillNames (zipBuffer) {
  const entry = findEntry(zipBuffer, 'activeskills.datc64')
  if (!entry) return new Map()

  const dat = readDatc64(readZipEntry(zipBuffer, entry))
  const cols = detectStringColumns(dat)

  // Id column: short snake_case identifiers, all distinct.
  const idCol = cols.find(c => {
    let seen = 0
    let ok = 0
    const values = new Set()
    for (let r = 0; r < dat.rowCount && seen < 400; r += 1) {
      const s = stringAt(dat, r, c.offset)
      if (typeof s !== 'string' || s === '') continue
      seen += 1
      values.add(s)
      if (SNAKE_ID.test(s)) ok += 1
    }
    return seen > 0 && ok / seen > 0.98 && values.size > seen * 0.9
  })
  if (!idCol) return new Map()

  // Name column: the Chinese column with the shortest average string. The long
  // one next to it is the skill description.
  const nameCol = cols
    .filter(c => c.offset !== idCol.offset && c.emptyRate < 0.6 && cjkRatio(dat, c.offset) > 0.5)
    .sort((a, b) => meanLength(dat, a.offset) - meanLength(dat, b.offset))[0]
  if (!nameCol) return new Map()

  const map = new Map()
  for (let r = 0; r < dat.rowCount; r += 1) {
    const id = stringAt(dat, r, idCol.offset)
    const name = stringAt(dat, r, nameCol.offset)
    if (typeof id !== 'string' || typeof name !== 'string') continue
    if (!CJK.test(name)) continue
    const key = normalizeSkillKey(id)
    if (!map.has(key)) map.set(key, name)
  }
  return map
}

/**
 * `Herald of Ash` -> `herald_of_ash`, `Battlemage's Cry` -> `battlemages_cry`.
 * Matches the id style of `ActiveSkills.datc64`.
 */
export function normalizeSkillKey (text) {
  return text
    .toLowerCase()
    .replace(/['\u2019\u02bc]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const GRANTS_REF = /^Grants Level (?:#|\d+) (.+?)(?: Skill)?$/

/**
 * Picks the skill name out of a trade-site `ref` such as
 * `Grants Level # Aspect of the Avian Skill` -> `Aspect of the Avian`.
 * Returns `null` for multi-line refs and for anything that is not a
 * "grants skill" mod.
 */
export function grantedSkillOf (ref) {
  if (ref.includes('\n')) return null
  const match = GRANTS_REF.exec(ref)
  return match ? match[1].trim() : null
}

/** Builds the line the client prints for a granted-skill mod. */
export function formatGrantsLine (template, skillName) {
  return template
    .replace('{1}', '#')
    .replace('{0}', skillName)
}

/** Reads the "grants skill" format string out of the patch. */
export function readGrantsTemplate (zipBuffer) {
  const entry = findEntry(zipBuffer, 'clientstrings.datc64')
  if (!entry) return FALLBACK_GRANTS_TEMPLATE
  const dat = readDatc64(readZipEntry(zipBuffer, entry))
  return readClientString(dat, GRANTS_LINE_KEY) ?? FALLBACK_GRANTS_TEMPLATE
}
