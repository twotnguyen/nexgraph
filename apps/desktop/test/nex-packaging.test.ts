import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertNoNexBinaryInAsar,
  assertPackagedNexRuntime,
  packagedBinaryPath,
  sha256File
} from '../scripts/nex-runtime.mjs'
import { resourcesDir } from '../scripts/license-files.mjs'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ng-nex-packaging-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** Dựng app.asar tối thiểu đúng định dạng asar: [pickle 8 B][headerBuf: 4 B + 4 B + JSON]. */
function writeAsar(appDir: string, files: Record<string, unknown>) {
  const resources = resourcesDir(appDir, 'darwin')
  mkdirSync(resources, { recursive: true })
  const json = Buffer.from(JSON.stringify({ files }), 'utf8')
  const headerBuf = Buffer.alloc(8 + json.length)
  headerBuf.writeUInt32LE(4, 0)
  headerBuf.writeUInt32LE(json.length, 4)
  json.copy(headerBuf, 8)
  const size = Buffer.alloc(8)
  size.writeUInt32LE(4, 0)
  size.writeUInt32LE(headerBuf.length, 4)
  writeFileSync(join(resources, 'app.asar'), Buffer.concat([size, headerBuf]))
}

describe('nex-packaging: electron-builder chép binary vào resources/opencode (PKG-NEX-2)', () => {
  const desktop = new URL('..', import.meta.url)
  // Checkout trên Windows có thể trả CRLF; chuẩn hoá trước khi so khớp nhiều dòng (bài học QA #68).
  const builder = readFileSync(new URL('electron-builder.yml', desktop), 'utf8').replace(/\r\n/g, '\n')
  const pkg = JSON.parse(readFileSync(new URL('package.json', desktop), 'utf8'))

  it('mac và win khai extraResources riêng, đích là opencode/', () => {
    expect(builder).toMatch(/mac:[\s\S]*from: build-resources\/opencode\/opencode\n\s+to: opencode\/opencode/)
    expect(builder).toMatch(/win:[\s\S]*from: build-resources\/opencode\/opencode\.exe\n\s+to: opencode\/opencode\.exe/)
  })

  it('script package và package:dir gọi fetch trước khi build', () => {
    expect(pkg.scripts.package).toMatch(/^node scripts\/fetch-nex-runtime\.mjs && /)
    expect(pkg.scripts['package:dir']).toMatch(/^node scripts\/fetch-nex-runtime\.mjs && /)
  })

  it('đường dẫn binary trong gói đúng nền tảng', () => {
    expect(packagedBinaryPath('/x/NexGraph.app', 'darwin')).toBe(join('/x/NexGraph.app', 'Contents', 'Resources', 'opencode', 'opencode'))
    expect(packagedBinaryPath('C:\\x\\win-unpacked', 'win32')).toBe(win32.join('C:\\x\\win-unpacked', 'resources', 'opencode', 'opencode.exe'))
  })

  it('asar không có binary thì qua, có thì fail kèm đường dẫn', () => {
    const appDir = join(root, 'NexGraph.app')
    writeAsar(appDir, { out: { files: { 'index.js': { size: 1 } } }, 'package.json': { size: 2 } })
    expect(() => assertNoNexBinaryInAsar(appDir, 'darwin')).not.toThrow()

    writeAsar(appDir, { opencode: { files: { opencode: { size: 3 } } } })
    expect(() => assertNoNexBinaryInAsar(appDir, 'darwin')).toThrow(/app\.asar.*opencode/)
  })
})

describe.runIf(process.platform !== 'win32')('nex-packaging: kiểm runtime Nex đã đóng gói (PKG-NEX-3)', () => {
  async function fakeConfig(binSha: string, version = '2.4.1') {
    const file = join(root, 'nex-runtime.json')
    writeFileSync(file, JSON.stringify({
      version,
      source: 'https://example.test',
      assets: {
        'darwin-arm64': {
          url: 'https://example.test/opencode-darwin-arm64.zip',
          filename: 'opencode-darwin-arm64.zip',
          sha256: '0'.repeat(64),
          binarySha256: binSha,
          bytes: 1,
          binary: 'opencode'
        }
      }
    }))
    return file
  }

  // Binary thật ~240 MB; script giả phải > 1 MB để qua bước chặn tệp rỗng.
  const stub = `#!/bin/sh\n# ${'x'.repeat(1_100_000)}\necho "opencode v2.4.1"\n`
  function fakeBinary(appDir: string, body = stub, mode = 0o755) {
    const bin = packagedBinaryPath(appDir, 'darwin')
    mkdirSync(dirname(bin), { recursive: true })
    writeFileSync(bin, body)
    chmodSync(bin, mode)
    return bin
  }

  it('binary có quyền thực thi, đúng sha thì chạy --version và in bản ghim', async () => {
    const appDir = join(root, 'NexGraph.app')
    const bin = fakeBinary(appDir)
    const file = await fakeConfig(await sha256File(bin))
    const lines: string[] = []
    await expect(assertPackagedNexRuntime({ appDir, platform: 'darwin', file, log: (l) => lines.push(l) }))
      .resolves.toBe('opencode v2.4.1')
    expect(lines.join('\n')).toMatch(/Runtime Nex trong gói: opencode v2\.4\.1/)
  })

  it('thiếu binary, thiếu quyền thực thi, sai sha đều fail rõ', async () => {
    const appDir = join(root, 'NexGraph.app')
    const file = await fakeConfig('1'.repeat(64))
    await expect(assertPackagedNexRuntime({ appDir, platform: 'darwin', file, log: () => {} }))
      .rejects.toThrow(/thiếu runtime Nex/)

    const bin = fakeBinary(appDir, stub, 0o644)
    await expect(assertPackagedNexRuntime({ appDir, platform: 'darwin', file, log: () => {} }))
      .rejects.toThrow(/quyền thực thi/)

    chmodSync(bin, 0o755)
    await expect(assertPackagedNexRuntime({ appDir, platform: 'darwin', file, log: () => {} }))
      .rejects.toThrow(/Sai sha256/)
  })
})

describe('nex-packaging: CI job package (PKG-NEX-3)', () => {
  const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const job = ci.slice(ci.indexOf('\n  package:'), ci.indexOf('\n  release:'))

  it('job package tải runtime Nex có cache theo hash tệp ghim, trước bước đóng gói', () => {
    expect(job).toMatch(/actions\/cache@[0-9a-f]{40}/)
    expect(job).toContain("hashFiles('apps/desktop/nex-runtime.json')")
    const fetchAt = job.indexOf('node apps/desktop/scripts/fetch-nex-runtime.mjs')
    const buildAt = job.indexOf('Đóng gói ứng dụng (electron-builder)')
    expect(fetchAt).toBeGreaterThan(-1)
    expect(buildAt).toBeGreaterThan(fetchAt)
  })
})
