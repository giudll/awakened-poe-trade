// `.datc64` reader, no dependencies.
//
// File layout:
//   uint32   rowCount
//   ...      fixed size rows, `rowCount * rowLength` bytes, fields packed in
//            schema order with no padding
//   uint8[8] 0xBB marker that starts the variable length section; its offset has
//            to be divisible by `rowCount`, which is how `rowLength` is derived
//   ...      variable length section: UTF-16LE strings (NUL terminated), arrays...
//
// A string field is 8 bytes wide: the first 4 are an offset into the variable
// length section, the remaining 4 are unused.
// No `.dat` schema is needed: string columns are found by requiring that the
// *whole column* decodes to sane text.

const VDATA_MAGIC = Buffer.alloc(8, 0xbb)
const MEM32_NULL = 0xfefefefe
const MAX_STRING_CHARS = 512

// Hangul / private use / replacement characters only show up when a pointer is
// read one byte off, so they are what the sanity check rejects.
function isGarbageCode (cp) {
  if (cp === 0xfffd) return true
  if (cp >= 0x1100 && cp <= 0x11ff) return true
  if (cp >= 0x3130 && cp <= 0x318f) return true
  if (cp >= 0xac00 && cp <= 0xd7af) return true
  if (cp >= 0xe000 && cp <= 0xf8ff) return true
  return false
}

export function readDatc64 (buf) {
  const rowCount = buf.readUInt32LE(0)
  let boundary = -1
  let from = 4
  for (;;) {
    const idx = buf.indexOf(VDATA_MAGIC, from)
    if (idx === -1) break
    const rel = idx - 4
    if (rowCount === 0 || rel % rowCount === 0) {
      boundary = rel
      break
    }
    from = idx + 1
  }
  if (boundary === -1) throw new Error('datc64: variable data boundary not found')

  return {
    rowCount,
    rowLength: rowCount > 0 ? boundary / rowCount : 0,
    dataFixed: buf.subarray(4, 4 + boundary),
    dataVariable: buf.subarray(4 + boundary)
  }
}

function decodeString (dataVariable, offset) {
  if (offset === MEM32_NULL) return null
  if (offset % 2 !== 0 || offset + 2 > dataVariable.length) return undefined
  let end = offset
  for (;;) {
    if (end + 4 > dataVariable.length) return undefined
    if (dataVariable.readUInt32LE(end) === 0) break
    end += 2
    if ((end - offset) / 2 > MAX_STRING_CHARS) return undefined
  }
  const text = dataVariable.subarray(offset, end).toString('utf16le')
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp < 0x20 && cp !== 0x09) return undefined
    if (isGarbageCode(cp)) return undefined
  }
  return text
}

function cellAt (dat, rowIdx, offset) {
  const p = rowIdx * dat.rowLength + offset
  if (p + 4 > dat.dataFixed.length) return undefined
  return dat.dataFixed.readUInt32LE(p)
}

// String at `offset` of one row, or null when the pointer is invalid.
export function stringAt (dat, rowIdx, offset) {
  const v = cellAt(dat, rowIdx, offset)
  if (v === undefined) return null
  const s = decodeString(dat.dataVariable, v)
  return s === undefined ? null : s
}

/**
 * All string columns of the table.
 * @returns {{ offset: number, coverage: number, emptyRate: number, distinct: number }[]}
 */
export function detectStringColumns (dat, { minCoverage = 0.995 } = {}) {
  const candidates = []
  for (let offset = 0; offset + 4 <= dat.rowLength; offset += 4) {
    let ok = 0
    let empty = 0
    const seen = new Set()
    let samples = 0
    for (let r = 0; r < dat.rowCount; r++) {
      const v = cellAt(dat, r, offset)
      if (v === undefined) break
      const s = decodeString(dat.dataVariable, v)
      if (s === undefined) continue
      ok++
      if (s === '' || s === null) empty++
      else if (samples < 200) { seen.add(s); samples++ }
    }
    const coverage = ok / dat.rowCount
    if (coverage >= minCoverage) {
      candidates.push({ offset, coverage, emptyRate: empty / dat.rowCount, distinct: seen.size })
    }
  }

  // Reading the neighbouring bytes of a field yields a shifted pointer, so one
  // field shows up as several candidates (offset, offset+4, offset+8 ...).
  // The real field is the first one: collapse candidates within 8 bytes and keep
  // the smallest offset.
  const picked = []
  for (const c of candidates) {
    const prev = picked[picked.length - 1]
    if (prev && c.offset - prev.offset < 8) continue
    picked.push(c)
  }
  return picked
}

/**
 * Picks the (Id, Name) pair of columns.
 * The Id is expected to look like `Metadata/...` (BaseItemTypes style); tables
 * such as `itemclasses` use plain short identifiers, which `fallbackToFirstPair`
 * accepts.
 */
export function readIdNameColumns (dat, { idPattern = /^(Metadata\/|Art\/)/, fallbackToFirstPair = false } = {}) {
  const cols = detectStringColumns(dat)
  const looksLikeId = (c) => {
    let hits = 0
    const n = Math.min(dat.rowCount, 300)
    for (let r = 0; r < n; r++) if (idPattern.test(stringAt(dat, r, c.offset) ?? '')) hits++
    if (hits / n <= 0.9) return false
    const first = stringAt(dat, 0, c.offset)
    return typeof first === 'string' && idPattern.test(first)
  }
  const idCol = cols.find(looksLikeId) ?? (fallbackToFirstPair ? cols[0] : undefined)
  if (!idCol) return null
  const nameCol = cols.find((c) => c.offset > idCol.offset && c.emptyRate < 0.2 && c.distinct > 10)
  if (!nameCol) return null
  const rows = []
  for (let r = 0; r < dat.rowCount; r++) {
    rows.push({ id: stringAt(dat, r, idCol.offset), name: stringAt(dat, r, nameCol.offset) })
  }
  return { idOffset: idCol.offset, nameOffset: nameCol.offset, columns: cols, rows }
}
