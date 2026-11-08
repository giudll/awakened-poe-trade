// Downloads the 编年史 (poedb) Simplified Chinese patch.
//
// The address is embedded in aianlinb/LibGGPK3,
// `Examples/VPatchGGPK3/MainWindow.cs`:
//   https://poedb.tw/fg/pin_cn.json   -> { version, md5, pin }
//   https://poedb.tw/fg/{md5}.zip     -> the Bundles2 asset replacement archive
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PIN_URL = 'https://poedb.tw/fg/pin_cn.json'
export const zipUrl = (md5) => `https://poedb.tw/fg/${md5}.zip`

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CACHE_DIR = path.resolve(__dirname, '../.cache')

async function exists (p) {
  try { await stat(p); return true } catch { return false }
}

/**
 * @returns {Promise<{ version: string, md5: string, pin: string }>}
 */
export async function fetchPin () {
  const res = await fetch(PIN_URL, { headers: { 'user-agent': 'awakened-poe-trade-zh-cn' } })
  if (!res.ok) throw new Error(`pin_cn.json: HTTP ${res.status}`)
  const json = await res.json()
  if (!json?.md5 || !/^[0-9a-f]{32}$/i.test(json.md5)) {
    throw new Error(`pin_cn.json: unexpected payload ${JSON.stringify(json)}`)
  }
  return json
}

/**
 * Ensures the patch zip is available locally and returns { buffer, version, md5, cached }.
 * @param {{ localZip?: string, offline?: boolean }} opts
 */
export async function getPatchZip (opts = {}) {
  let version = 'unknown'
  let md5 = ''
  let buffer

  if (opts.localZip) {
    buffer = await readFile(opts.localZip)
    // local files are named after their md5 by poedb, but don't rely on it
    const actual = createHash('md5').update(buffer).digest('hex')
    if (path.basename(opts.localZip, '.zip').toLowerCase() === actual) md5 = actual
    return { buffer, version, md5, cached: false, source: opts.localZip }
  }

  const pin = await fetchPin()
  version = pin.version
  md5 = pin.md5

  await mkdir(CACHE_DIR, { recursive: true })
  const cachePath = path.join(CACHE_DIR, `${md5}.zip`)

  if (await exists(cachePath)) {
    buffer = await readFile(cachePath)
    const actual = createHash('md5').update(buffer).digest('hex')
    if (actual === md5) return { buffer, version, md5, cached: true, source: cachePath }
  }

  if (opts.offline) {
    throw new Error(`Offline mode and no cached patch for md5 ${md5} at ${cachePath}`)
  }

  const res = await fetch(zipUrl(md5), { headers: { 'user-agent': 'awakened-poe-trade-zh-cn' } })
  if (!res.ok) throw new Error(`${zipUrl(md5)}: HTTP ${res.status}`)
  buffer = Buffer.from(await res.arrayBuffer())

  const actual = createHash('md5').update(buffer).digest('hex')
  if (actual !== md5) throw new Error(`Patch MD5 mismatch: expected ${md5}, got ${actual}`)

  await writeFile(cachePath, buffer)
  return { buffer, version, md5, cached: false, source: cachePath }
}
