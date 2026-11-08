// Renders `data/app-i18n-zh.mjs` onto the key structure of
// `renderer/public/data/en/app_i18n.json` and writes
// `renderer/public/data/zh_CN/app_i18n.json`.
//
// The English file is the contract: every key it has must be translated, and no
// extra keys are allowed. Upstream occasionally adds UI strings - when that
// happens this script fails loudly instead of shipping a half English UI, so the
// daily upstream watcher notices it and leaves the new strings for translation.
//
// Usage:
//   node build-app-i18n.mjs            # write the file
//   node build-app-i18n.mjs --check    # verify only, never write (CI)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import table from './data/app-i18n-zh.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const enFile = path.join(root, 'renderer/public/data/en/app_i18n.json')
const zhFile = path.join(root, 'renderer/public/data/zh_CN/app_i18n.json')

const en = JSON.parse(fs.readFileSync(enFile, 'utf8'))

const missing = []
const extra = new Set(Object.keys(table))

const walk = (node, prefix) => {
  if (typeof node === 'string') {
    const key = prefix
    extra.delete(key)
    const value = table[key]
    if (typeof value !== 'string') {
      missing.push(key)
      return node
    }
    // placeholders are positional, a dropped {1} silently breaks the sentence
    for (const ph of node.match(/\{\d+\}/g) ?? []) {
      if (!value.includes(ph)) {
        throw new Error(`${key}: placeholder ${ph} missing in "${value}"`)
      }
    }
    if (/\|/.test(value)) {
      // vue-i18n treats `|` as the plural separator
      throw new Error(`${key}: "|" is not allowed in a message, got "${value}"`)
    }
    return value
  }
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    out[key] = walk(value, prefix ? `${prefix}.${key}` : key)
  }
  return out
}

const zh = walk(en, '')

// Upstream also hardcodes a handful of labels by using the English text *as* the
// i18n key - `t('Search')`, `t('Save')`, `t('Cancel')` - and those keys do not
// exist in `en/app_i18n.json`. English users see the key, which happens to read
// like a label, so the bug is invisible in English and glaring in Chinese.
//
// The fix is a Chinese-only entry: adding `"Search": "搜索"` to the zh bundle
// translates the button, while the English bundle keeps its current output and
// no upstream component is touched (which keeps the daily upstream merge clean).
// The allow-list is scanned from the source, so it cannot drift.
const scanHardcodedKeys = () => {
  const keys = new Set()
  const re = /\$?t\(\s*(['"])((?:\\.|(?!\1).)*)\1/g
  const walkDir = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkDir(p)
      } else if (/\.(vue|ts)$/.test(entry.name)) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(re)) {
          const key = m[2]
          // `:foo` is a namespace prefix, `a.b` is nested, `{x}` is a variable
          if (!key || key.startsWith(':') || key.includes('.') || /[<>{}\n]/.test(key)) continue
          keys.add(key)
        }
      }
    }
  }
  walkDir(path.join(root, 'renderer/src'))
  return keys
}

const hardcodedKeys = scanHardcodedKeys()
const untranslated = []

// `extra.*` keys cover UI text hardcoded in components that pass the English
// string as vue-i18n's default value; the top-level hardcoded keys above cover
// the older `t('English')` style.
const extraKeys = [...extra]
for (const key of extraKeys) {
  extra.delete(key)
  if (key.startsWith('extra.')) {
    const parts = key.split('.')
    let node = zh
    for (const part of parts.slice(0, -1)) {
      node[part] ??= {}
      node = node[part]
    }
    node[parts.at(-1)] = table[key]
  } else if (hardcodedKeys.has(key) && !key.includes('.')) {
    zh[key] = table[key]
  } else {
    untranslated.push(key)
  }
}

if (missing.length) {
  throw new Error(
    `untranslated UI strings (${missing.length}):\n  ${missing.join('\n  ')}\n` +
    `add them to tools/zh-data/data/app-i18n-zh.mjs`
  )
}
if (untranslated.length) {
  throw new Error(
    `stale keys in app-i18n-zh.mjs (${untranslated.length}):\n  ${untranslated.join('\n  ')}\n` +
    `upstream no longer uses them, and they are not hardcoded in any component`
  )
}

const serialized = JSON.stringify(zh, null, 2) + '\n'

if (process.argv.includes('--check')) {
  const current = fs.existsSync(zhFile) ? fs.readFileSync(zhFile, 'utf8') : ''
  if (current !== serialized) {
    throw new Error(`${path.relative(root, zhFile)} is out of date, run: node tools/zh-data/build-app-i18n.mjs`)
  }
  console.log(`app_i18n: ${Object.keys(table).length} strings, up to date`)
} else {
  fs.writeFileSync(zhFile, serialized)
  console.log(`app_i18n: wrote ${Object.keys(table).length} strings to ${path.relative(root, zhFile)}`)
}
