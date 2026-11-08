import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import type { TranslationDict } from './interfaces'
import {
  applyItemsData,
  applyStatsData,
  setClientStrings,
  setStaticData,
  validateLoadedStats
} from './index'

function defaultDataDir () {
  // Reuse the checked-in renderer data bundle so parser tests do not need Vite.
  return fileURLToPath(new URL('../../../public/data', import.meta.url))
}

async function importTranslationDict (filepath: string) {
  const module = await import(pathToFileURL(filepath).href)
  return module.default as TranslationDict
}

async function readUint32Array (filepath: string) {
  const data = await readFile(filepath)
  return new Uint32Array(data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ))
}

/**
 * Bootstraps the data layer outside of the browser (used by `scripts/parse-item.ts`
 * and other offline checks).
 */
export async function initForNode (lang: string, options?: { dataDir?: string }) {
  const dataDir = options?.dataDir ?? defaultDataDir()

  setStaticData({
    clientStringsRef: await importTranslationDict(path.join(dataDir, 'en', 'client_strings.js')),
    itemDrop: JSON.parse(await readFile(path.join(dataDir, 'item-drop.json'), 'utf8')),
    appPatrons: JSON.parse(await readFile(path.join(dataDir, 'patrons.json'), 'utf8'))
  })

  setClientStrings(await importTranslationDict(path.join(dataDir, lang, 'client_strings.js')))

  applyItemsData(
    await readFile(path.join(dataDir, lang, 'items.ndjson'), 'utf8'),
    await readUint32Array(path.join(dataDir, lang, 'items-name.index.bin')),
    await readUint32Array(path.join(dataDir, lang, 'items-ref.index.bin'))
  )

  applyStatsData(
    await readFile(path.join(dataDir, lang, 'stats.ndjson'), 'utf8'),
    await readUint32Array(path.join(dataDir, lang, 'stats-ref.index.bin')),
    await readUint32Array(path.join(dataDir, lang, 'stats-matcher.index.bin'))
  )

  validateLoadedStats(lang)
}
