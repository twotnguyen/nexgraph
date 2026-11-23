import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DATA_DIR_MARKER, enginePids, isTemporaryDir, prepareDataDir, readDataDirMarker } from '../e2e/data-dir'

const cleaned: string[] = []
const children: ChildProcess[] = []

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

function sleepChild(ms: number): ChildProcess {
  const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { stdio: 'ignore' })
  children.push(child)
  return child
}

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL')
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

    await prepareDataDir(dir, { pids: [process.pid] })

    expect(existsSync(join(dir, 'cu.txt'))).toBe(false)
    expect(readDataDirMarker(dir)?.pids).toEqual([process.pid])
  })

  it('chờ tiến trình của lượt trước thoát rồi mới xoá', async () => {
    const dir = tmpDataDir()
    mkdirSync(dir, { recursive: true })
    const child = sleepChild(900)
    writeFileSync(join(dir, DATA_DIR_MARKER), JSON.stringify({ pids: [child.pid] }))
    writeFileSync(join(dir, 'cu.txt'), 'x')
    const started = Date.now()

    await prepareDataDir(dir, { exitTimeoutMs: 10_000 })

    expect(Date.now() - started).toBeGreaterThanOrEqual(500)
    expect(child.exitCode ?? child.signalCode).not.toBeNull()
    expect(existsSync(join(dir, 'cu.txt'))).toBe(false)
  })

  it('báo lỗi rõ và không xoá khi tiến trình lượt trước còn sống', async () => {
    const dir = tmpDataDir()
    mkdirSync(dir, { recursive: true })
    const child = sleepChild(5_000)
    writeFileSync(join(dir, DATA_DIR_MARKER), JSON.stringify({ pids: [child.pid] }))
    writeFileSync(join(dir, 'cu.txt'), 'x')

    await expect(prepareDataDir(dir, { exitTimeoutMs: 300 })).rejects.toThrow(/còn tiến trình giữ thư mục/)

    expect(existsSync(join(dir, 'cu.txt'))).toBe(true)
  })

  it('enginePids bỏ qua tiến trình không liên quan tới data dir', () => {
    expect(enginePids(join(tmpdir(), 'ng-e2e-khong-co-that-123456'))).toEqual([])
  })
})
