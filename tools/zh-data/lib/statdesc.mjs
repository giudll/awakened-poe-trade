// Parser for PoE `Metadata/StatDescriptions/*.txt` files.
//
// File format (UTF-16, tab indented):
//
//   description
//   \t1 <stat id>
//   \t<count>
//   \t\t1|# "text with {0} placeholders"
//   \t\t#|-1 "negated text" negate 1
//   \tlang "Russian"
//   \t<count>
//   ...
//
// The same file lists every client language. The 编年史 patch puts the
// Simplified Chinese text into the `Traditional Chinese` slot (that is the
// language slot the international client renders), so that is the slot we read
// by default.

const ID_LINE = /^\d+\s+(.+)$/
const TEXT_LINE = /^[^"]*"([^"]*)"/
const LANG_LINE = /^lang\s+"([^"]+)"/

/** @typedef {{ id: string, text: string }} StatDescriptionEntry */
/** @typedef {{ ids: string[], byLang: Map<string, string[]> }} StatDescriptionBlock */

function unescapeText (s) {
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const c = s[i + 1]
      switch (c) {
        case 'n': out += '\n'; break
        case 't': out += '\t'; break
        case 'r': out += '\r'; break
        case '\\': out += '\\'; break
        case '"': out += '"'; break
        default: out += '\\' + c
      }
      i += 1
    } else {
      out += s[i]
    }
  }
  return out
}

/**
 * Converts game placeholders into the `#` form used by the app data.
 * `{0}`, `{0:+d}`, `{:d}`, `{0:.1f}` -> `#`
 */
export function normalizePlaceholders (text) {
  return unescapeText(text)
    .replace(/\{[^{}]*\}/g, '#')
    .replace(/[{}]+/g, '')
    .replace(/<[^>]+>/g, '')
}

/**
 * @param {string} text
 * @returns {StatDescriptionBlock[]}
 */
export function parseStatDescriptions (text) {
  const lines = text.split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    if (lines[i].trim() !== 'description') {
      i += 1
      continue
    }
    i += 1
    const idMatch = ID_LINE.exec(lines[i]?.trim() ?? '')
    if (!idMatch) continue

    const ids = idMatch[1].trim().split(/\s+/)
    i += 1

    /** @type {Map<string, string[]>} */
    const byLang = new Map()
    let lang = 'English'

    while (i < lines.length) {
      const line = lines[i].trim()
      if (line === 'description') break
      if (line === '') { i += 1; continue }
      if (!/^\d+$/.test(line)) break

      const count = Number(line)
      i += 1
      let bucket = byLang.get(lang)
      if (!bucket) { bucket = []; byLang.set(lang, bucket) }

      for (let k = 0; k < count; k += 1) {
        const textMatch = TEXT_LINE.exec(lines[i]?.trim() ?? '')
        i += 1
        if (textMatch) bucket.push(normalizePlaceholders(textMatch[1]))
      }

      const langMatch = LANG_LINE.exec(lines[i]?.trim() ?? '')
      if (langMatch) {
        lang = langMatch[1]
        // Some stats repeat the same language block; keep only the last one.
        byLang.set(lang, [])
        i += 1
      }
    }

    blocks.push({ ids, byLang })
  }

  return blocks
}

/**
 * Builds a map from English stat text to the target language text.
 * Only entries where both sides exist are emitted.
 * @param {StatDescriptionBlock[]} blocks
 * @param {string} targetLang
 * @returns {{ pairs: Map<string, Set<string>>, stats: { blocks: number, en: number, translated: number } }}
 */
export function buildTextPairs (blocks, targetLang) {
  /** @type {Map<string, Set<string>>} */
  const pairs = new Map()
  let enCount = 0
  let translated = 0

  for (const block of blocks) {
    const en = block.byLang.get('English') ?? []
    const target = block.byLang.get(targetLang) ?? []
    enCount += en.length
    if (!target.length) continue
    translated += 1

    for (let i = 0; i < en.length; i += 1) {
      const enText = en[i].trim()
      const targetText = target[i]?.trim()
      if (!enText || !targetText) continue
      let set = pairs.get(enText)
      if (!set) { set = new Set(); pairs.set(enText, set) }
      set.add(targetText)
    }
  }

  return { pairs, stats: { blocks: blocks.length, en: enCount, translated } }
}
