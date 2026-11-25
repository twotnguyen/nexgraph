import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assetFor,
  assertSha256,
  binaryName,
  isRuntimeCurrent,
  loadNexRuntime,
  platformKey,
  runtimeBinaryPath,
  sha256File
} from '../scripts/nex-runtime.mjs'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ng-nex-runtime-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('nex-runtime: tệp ghim runtime Nex (PKG-NEX-1)', () => {
  const config = loadNexRuntime()

  it('ghim OpenCode 2.4.1 với đủ hai nền tảng và sha256 64 ký tự', () => {
    expect(config.version).toBe('2.4.1')
    for (const key of ['darwin-arm64', 'windows-x64']) {
      const asset = config.assets[key]
      expect(asset, `thiếu asset ${key}`).toBeTruthy()
      expect(asset.url).toMatch(/^https:\/\/github\.com\/anomalyco\/opencode\/releases\/download\/v2\.4\.1\//)
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(asset.binarySha256).toMatch(/^[0-9a-f]{64}$/)
      expect(asset.bytes).toBeGreaterThan(100 * 1000 * 1000)
    }
  })

  it('ánh xạ platform/arch sang khoá asset, nền tảng lạ thì báo rõ', () => {
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(platformKey('win32', 'x64')).toBe('windows-x64')
    expect(() => platformKey('darwin', 'x64')).toThrow(/darwin-arm64.*windows-x64/)
    expect(() => platformKey('linux', 'x64')).toThrow(/chưa hỗ trợ/)
  })

  it('tên binary đúng nền tảng và nằm trong thư mục opencode/', () => {
    expect(binaryName('darwin')).toBe('opencode')
    expect(binaryName('win32')).toBe('opencode.exe')
    expect(runtimeBinaryPath('/tmp/out', 'darwin')).toBe(join('/tmp/out', 'opencode'))
    expect(runtimeBinaryPath('C:\\out', 'win32')).toBe(join('C:\\out', 'opencode.exe'))
  })

  it('assetFor trả đúng mục theo platform/arch', () => {
    expect(assetFor(config, 'darwin', 'arm64')).toBe(config.assets['darwin-arm64'])
    expect(assetFor(config, 'win32', 'x64')).toBe(config.assets['windows-x64'])
  })

  it('sha256File tính đúng sha256 của tệp', async () => {
    const file = join(root, 'abc.bin')
    writeFileSync(file, 'abc')
    await expect(sha256File(file)).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('sai sha256 thì fail kèm cả giá trị mong đợi và nhận được', () => {
    expect(() => assertSha256('aa', 'aa', 'tệp.zip')).not.toThrow()
    expect(() => assertSha256('bb', 'aa', 'opencode-darwin-arm64.zip')).toThrow(/opencode-darwin-arm64\.zip.*aa.*bb/)
  })

  it('isRuntimeCurrent: thiếu tệp hoặc sai nội dung là false, đúng sha là true', async () => {
    const file = join(root, 'opencode')
    const src = join(root, 'src.bin')
    writeFileSync(src, 'noi dung')
    const expected = await sha256File(src)
    await expect(isRuntimeCurrent(file, expected)).resolves.toBe(false)
    writeFileSync(file, 'sai')
    await expect(isRuntimeCurrent(file, expected)).resolves.toBe(false)
    writeFileSync(file, 'noi dung')
    await expect(isRuntimeCurrent(file, expected)).resolves.toBe(true)
  })
})
