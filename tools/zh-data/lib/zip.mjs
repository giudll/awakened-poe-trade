// Minimal ZIP reader (no dependencies). Supports stored + deflate entries.
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

function findEocd (buf) {
  const min = Math.max(0, buf.length - 0xFFFF - 22)
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  throw new Error('Not a zip file (no End Of Central Directory record)')
}

/**
 * @param {Buffer} buf
 * @returns {Array<{ name: string, method: number, compressedSize: number, size: number, localOffset: number }>}
 */
export function listZipEntries (buf) {
  const eocd = findEocd(buf)
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error(`Corrupt central directory at ${p}`)
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.push({ name, method, compressedSize, size, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * @param {Buffer} buf
 * @param {{ method: number, compressedSize: number, localOffset: number }} entry
 * @returns {Buffer}
 */
export function readZipEntry (buf, entry) {
  const p = entry.localOffset
  if (buf.readUInt32LE(p) !== LOC_SIG) throw new Error(`Corrupt local header at ${p}`)
  const nameLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const start = p + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error(`Unsupported compression method ${entry.method}`)
}
