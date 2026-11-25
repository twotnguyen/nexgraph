import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertNoNexBinaryInAsar, packagedBinaryPath } from '../scripts/nex-runtime.mjs'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ng-nex-packaging-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** Dựng app.asar tối thiểu đúng định dạng asar: [size pickle][độ dài JSON][JSON][padding]. */
function writeAsar(appDir: string, files: Record<string, unknown>) {
  const resources = join(appDir, 'Contents', 'Resources')
  mkdirSync(resources, { recursive: true })
  const json = Buffer.from(JSON.stringify({ files }), 'utf8')
  const head = Buffer.alloc(8)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(json.length, 4)
  writeFileSync(join(resources, 'app.asar'), Buffer.concat([head, json]))
}

describe('nex-packaging: electron-builder chép binary vào resources/opencode (PKG-NEX-2)', () => {
  const desktop = new URL('..', import.meta.url)
  const builder = readFileSync(new URL('electron-builder.yml', desktop), 'utf8')
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
