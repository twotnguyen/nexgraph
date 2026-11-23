import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REQUIRED_LICENSE_FILES, assertLicenseFiles, missingLicenseFiles, resourcesDir } from '../scripts/license-files.mjs'

let root = ''
const appDir = () => join(root, 'NexGraph.app')
const write = (name: string, size = 10) => writeFileSync(join(resourcesDir(appDir(), 'darwin'), name), '#'.repeat(size))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ng-license-'))
  mkdirSync(resourcesDir(appDir(), 'darwin'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('license-files: tệp giấy phép trong gói cài (P3-8.2)', () => {
  it('macOS đọc Contents/Resources, Windows đọc resources/', () => {
    expect(resourcesDir('/x/NexGraph.app', 'darwin')).toBe('/x/NexGraph.app/Contents/Resources')
    expect(resourcesDir('/x/win-unpacked', 'win32')).toBe('/x/win-unpacked/resources')
  })

  it('báo đủ cả ba tệp khi Resources rỗng (lỗi RC2)', () => {
    expect(missingLicenseFiles(appDir(), 'darwin')).toEqual([...REQUIRED_LICENSE_FILES])
    expect(() => assertLicenseFiles(appDir(), 'darwin')).toThrow(/THIRD_PARTY_LICENSES\.md.*NOTICE.*LICENSE/)
  })

  it('báo tệp rỗng 0 byte là thiếu', () => {
    for (const name of REQUIRED_LICENSE_FILES) write(name)
    write('NOTICE', 0)
    expect(missingLicenseFiles(appDir(), 'darwin')).toEqual(['NOTICE'])
  })

  it('đủ ba tệp có nội dung thì qua', () => {
    for (const name of REQUIRED_LICENSE_FILES) write(name)
    expect(missingLicenseFiles(appDir(), 'darwin')).toEqual([])
    expect(() => assertLicenseFiles(appDir(), 'darwin')).not.toThrow()
  })
})
