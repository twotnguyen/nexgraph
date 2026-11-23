import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DATA_DIR_MARKER, isTemporaryDir, prepareDataDir, readDataDirMarker } from '../e2e/data-dir'

const cleaned: string[] = []

/** Thư mục ngoài tmpdir: mô phỏng người dùng trỏ NEXGRAPH_E2E_DATA_DIR vào thư mục thật. */
function outsideTmpDir(): string {
  const dir = mkdtempSync(join(process.cwd(), '.e2e-data-dir-test-'))
  cleaned.push(dir)
  return dir
}

function tmpDataDir(): string {
  const base = mkdtempSync(join(tmpdir(), 'ng-e2e-guard-'))
  cleaned.push(base)
  return join(base, 'engine-data')
}

afterEach(() => {
  for (const dir of cleaned.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('NEXGRAPH_E2E_DATA_DIR chỉ bị xoá khi chắc chắn là của E2E', () => {
  it('xoá thư mục tạm không có marker (lượt đầu)', async () => {
    const dir = tmpDataDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'cu.txt'), 'x')
    expect(isTemporaryDir(dir)).toBe(true)

    await prepareDataDir(dir)

    expect(existsSync(join(dir, 'cu.txt'))).toBe(false)
    expect(readDataDirMarker(dir)?.pids).toEqual([])
  })

  it('từ chối thư mục ngoài tmp không có marker và không xoá gì', async () => {
    const dir = outsideTmpDir()
    writeFileSync(join(dir, 'giu-lai.txt'), 'dữ liệu thật')
    expect(isTemporaryDir(dir)).toBe(false)

    await expect(prepareDataDir(dir)).rejects.toThrow(/Từ chối xoá/)
    expect(existsSync(join(dir, 'giu-lai.txt'))).toBe(true)
    expect(existsSync(join(dir, DATA_DIR_MARKER))).toBe(false)
  })

  it('xoá thư mục ngoài tmp khi có marker do E2E tạo', async () => {
    const dir = outsideTmpDir()
    writeFileSync(join(dir, DATA_DIR_MARKER), JSON.stringify({ pids: [], createdAt: new Date().toISOString() }))
    writeFileSync(join(dir, 'cu.txt'), 'x')

    await prepareDataDir(dir, [process.pid])

    expect(existsSync(join(dir, 'cu.txt'))).toBe(false)
    expect(readDataDirMarker(dir)?.pids).toEqual([process.pid])
  })
})
