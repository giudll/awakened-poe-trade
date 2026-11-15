// Fingerprint of everything the generated bundle is derived from:
//
//   * `renderer/public/data/en/` - the upstream English skeleton
//   * `tools/zh-data/data/new-content.json` - the additive overlay
//
// The 编年史 patch is fingerprinted by its md5 (see `zh-data.lock.json`), so
// together these three answer "is the committed `zh_CN` bundle still the output
// of the current inputs?". `zh-data.yml` compares this value against the lock
// and rebuilds when it moved, which is what stops the bundle from sitting on an
// old skeleton after upstream ships new data.
//
//   node inputs-hash.mjs      # print the fingerprint
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DATA = path.join(ROOT, 'renderer/public/data')

const INPUTS = [
  ['en-items', path.join(DATA, 'en/items.ndjson')],
  ['en-stats', path.join(DATA, 'en/stats.ndjson')],
  ['overlay', path.join(__dirname, 'data/new-content.json')]
]

/** @returns {Promise<{ fingerprint: string, parts: Record<string, string> }>} */
export async function inputsFingerprint () {
  const hash = createHash('sha256')
  const parts = {}
  for (const [label, file] of INPUTS) {
    let digest
    try {
      digest = createHash('sha256').update(await readFile(file)).digest('hex')
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      digest = 'none'
    }
    parts[label] = digest.slice(0, 16)
    hash.update(`${label}=${digest}\n`)
  }
  return { fingerprint: hash.digest('hex').slice(0, 16), parts }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { fingerprint } = await inputsFingerprint()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(await inputsFingerprint(), null, 2))
  } else {
    console.log(fingerprint)
  }
}
