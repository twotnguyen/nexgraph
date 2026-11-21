import type { AgentPromptOptions } from '../../shared/agent-types'
import { UserError } from '../user-error'

const MAX_IMAGE_BYTES = 24 * 1024 * 1024
const badImage = () => new UserError('bad_param', 'Ảnh đính kèm không hợp lệ, sai định dạng hoặc vượt 24 MiB. Chỉ hỗ trợ PNG, JPEG, GIF và WebP.')

function png(bytes: Buffer): boolean {
  if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)) return false
  let offset = 8; let imageData = false
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset)
    const end = offset + 12 + size
    if (end > bytes.length) return false
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (type === 'IHDR' && offset !== 8) return false
    if (type === 'IDAT') {
      if (size === 0) return false
      imageData = true
    }
    if (type === 'IEND') return size === 0 && end === bytes.length && imageData
    offset = end
  }
  return false
}

function jpeg(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
  let offset = 2; let frame = false
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return false
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9) return false
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > bytes.length) return false
    const size = bytes.readUInt16BE(offset)
    if (size < 2 || offset + size > bytes.length) return false
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (size < 8 || !bytes.readUInt16BE(offset + 3) || !bytes.readUInt16BE(offset + 5)) return false
      frame = true
    }
    if (marker === 0xda) {
      if (!frame || size < 6 || offset + size >= bytes.length) return false
      for (let i = offset + size; i + 1 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true
      return false
    }
    offset += size
  }
  return false
}

function gif(bytes: Buffer): boolean {
  const header = bytes.toString('ascii', 0, 6)
  if (bytes.length < 14 || (header !== 'GIF87a' && header !== 'GIF89a') || !bytes.readUInt16LE(6) || !bytes.readUInt16LE(8)) return false
  let offset = 13 + (bytes[10] & 0x80 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0)
  let image = false
  const blocks = (): boolean => {
    while (offset < bytes.length) {
      const size = bytes[offset++]
      if (!size) return true
      offset += size
      if (offset > bytes.length) return false
    }
    return false
  }
  while (offset < bytes.length) {
    const marker = bytes[offset++]
    if (marker === 0x3b) return image && offset === bytes.length
    if (marker === 0x21) {
      if (offset >= bytes.length) return false
      offset++
      if (!blocks()) return false
    } else if (marker === 0x2c) {
      if (offset + 9 > bytes.length || !bytes.readUInt16LE(offset + 4) || !bytes.readUInt16LE(offset + 6)) return false
      const packed = bytes[offset + 8]
      offset += 9 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0)
      if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) return false
      offset++
      if (offset >= bytes.length || bytes[offset] === 0 || !blocks()) return false
      image = true
    } else return false
  }
  return false
}

function webp(bytes: Buffer): boolean {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) return false
  let offset = 12; let image = false
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const data = offset + 8
    const end = data + size + (size & 1)
    if (end > bytes.length) return false
    if (type === 'VP8 ' && size >= 10 && !(bytes[data] & 1) && bytes.subarray(data + 3, data + 6).toString('hex') === '9d012a' && (bytes.readUInt16LE(data + 6) & 0x3fff) && (bytes.readUInt16LE(data + 8) & 0x3fff)) image = true
    if (type === 'VP8L' && size >= 5 && bytes[data] === 0x2f) image = true
    if (type === 'ANMF' && size >= 34) {
      const frameType = bytes.toString('ascii', data + 16, data + 20)
      const frameSize = bytes.readUInt32LE(data + 20)
      if (frameSize + 24 > size) return false
      if (frameType === 'VP8 ' && frameSize >= 10 && !(bytes[data + 24] & 1) && bytes.subarray(data + 27, data + 30).toString('hex') === '9d012a') image = true
      if (frameType === 'VP8L' && frameSize >= 5 && bytes[data + 24] === 0x2f) image = true
    }
    offset = end
  }
  return image && offset === bytes.length
}

/** Renderer payloads are untrusted; inspect decoded bytes, not the claimed MIME or file name. */
export function validatePromptImages(options: unknown): asserts options is AgentPromptOptions | undefined {
  if (options === undefined) return
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw badImage()
  const images = 'images' in options ? options.images : undefined
  if (images === undefined) return
  if (!Array.isArray(images)) throw badImage()
  const formats: Record<string, (bytes: Buffer) => boolean> = { 'image/png': png, 'image/jpeg': jpeg, 'image/gif': gif, 'image/webp': webp }
  for (const image of images) {
    if (!image || typeof image !== 'object' || typeof image.mimeType !== 'string' || typeof image.data !== 'string' || !Object.hasOwn(formats, image.mimeType)) throw badImage()
    const data: string = image.data
    if (!data.length || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw badImage()
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    if ((padding === 2 && (alphabet.indexOf(data[data.length - 3]) & 15) !== 0) || (padding === 1 && (alphabet.indexOf(data[data.length - 2]) & 3) !== 0)) throw badImage()
    const size = data.length / 4 * 3 - padding
    if (size > MAX_IMAGE_BYTES) throw badImage()
    const bytes = Buffer.from(data, 'base64')
    if (bytes.length !== size || !formats[image.mimeType](bytes)) throw badImage()
  }
}
