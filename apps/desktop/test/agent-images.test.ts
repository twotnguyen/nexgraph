import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePromptImages } from '../src/main/features/agent/images'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aX0AAAAASUVORK5CYII='
const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

describe('agent image validation', () => {
  it('accepts supported PNG, GIF, JPEG and WebP image bytes', () => {
    const files = [
      { mimeType: 'image/png', data: png },
      { mimeType: 'image/gif', data: gif },
      { mimeType: 'image/jpeg', data: readFileSync(join(__dirname, '../../../docs/release/acceptance/windows-nestjs-index.jpg')).toString('base64') },
      { mimeType: 'image/webp', data: readFileSync(join(__dirname, '../../../design/logo/nexgraph-dag-logo.webp')).toString('base64') }
    ]
    expect(() => validatePromptImages({ images: files })).not.toThrow()
  })

  it('rejects malformed encoding, truncated files, mismatched MIME and excessive length', () => {
    for (const images of [
      null,
      [{ mimeType: 'image/png', data: Buffer.from(Buffer.from(png, 'base64').subarray(0, 20)).toString('base64') }],
      [{ mimeType: 'image/jpeg', data: png }],
      [{ mimeType: 'image/png', data: png.replace(/.$/, '!') }],
      [{ mimeType: 'image/png', data: 'A'.repeat(32 * 1024 * 1024 + 4) }]
    ]) expect(() => validatePromptImages({ images })).toThrow()
  })

  it('walks every PNG chunk: accepts extra chunks and rejects missing pixel data, a second IHDR or trailing bytes', () => {
    const chunk = (type: string, data = Buffer.alloc(0)) => {
      const size = Buffer.alloc(4)
      size.writeUInt32BE(data.length)
      return Buffer.concat([size, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)])
    }
    const header = Buffer.from(png, 'base64').subarray(0, 33)
    const idat = chunk('IDAT', Buffer.from([1, 2, 3]))
    const iend = chunk('IEND')
    const build = (...parts: Buffer[]) => ({ images: [{ mimeType: 'image/png', data: Buffer.concat([header, ...parts]).toString('base64') }] })
    expect(() => validatePromptImages(build(chunk('tEXt', Buffer.from('k\0v')), idat, idat, iend))).not.toThrow()
    for (const bad of [build(iend), build(chunk('IDAT'), iend), build(idat), build(chunk('IHDR', Buffer.alloc(13, 1)), idat, iend), build(idat, iend, Buffer.from([0]))])
      expect(() => validatePromptImages(bad)).toThrow()
  })
})
