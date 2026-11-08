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

// `extra.*` keys do not exist upstream. They cover UI text that is hardcoded in
// the components; those components pass the English string as vue-i18n's
// default value, so the English build is unaffected and no upstream file has to
// be touched (which keeps the daily upstream merge trivial).
const extraKeys = [...extra].filter(key => key.startsWith('extra.'))
for (const key of extraKeys) {
  extra.delete(key)
  const parts = key.split('.')
  let node = zh
  for (const part of parts.slice(0, -1)) {
    node[part] ??= {}
    node = node[part]
  }
  node[parts.at(-1)] = table[key]
}

if (missing.length) {
  throw new Error(
    `untranslated UI strings (${missing.length}):\n  ${missing.join('\n  ')}\n` +
    `add them to tools/zh-data/data/app-i18n-zh.mjs`
  )
}
if (extra.size) {
  throw new Error(
    `stale keys in app-i18n-zh.mjs (${extra.size}):\n  ${[...extra].join('\n  ')}\n` +
    `remove them, upstream no longer uses them`
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
