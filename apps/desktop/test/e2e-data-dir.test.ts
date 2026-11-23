import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_DIR_MARKER, enginePids, isProtectedRoot, isTemporaryDir, prepareDataDir, readDataDirMarker } from '../e2e/data-dir'

/**
 * Lưới an toàn cho chính bộ test: nếu code còn lỗi mà gọi `rmSync` lên gốc tạm/home/gốc ổ thì chặn ngay,
 * tuyệt đối không xoá thư mục thật (trên macOS `$TMPDIR` chứa cả worktree đang làm việc).
 */
const rmGuard = vi.hoisted(() => ({ blocked: new Set<string>() }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const os = await import('node:os')
  const path = await import('node:path')
  const normalize = (target: string): string => {
    try {
      return actual.realpathSync(target)
    } catch {
      return path.resolve(target)
    }
  }
  for (const root of ['/', '/tmp', os.tmpdir(), os.homedir()]) {
    rmGuard.blocked.add(normalize(root))
    rmGuard.blocked.add(path.resolve(root))
  }
  const rmSync = ((target: Parameters<typeof actual.rmSync>[0], options?: Parameters<typeof actual.rmSync>[1]) => {
    if (rmGuard.blocked.has(normalize(String(target)))) {
      throw new Error(`CHẶN xoá thư mục gốc trong test: ${String(target)}`)
    }
    return actual.rmSync(target, options)
  }) as typeof actual.rmSync
  return { ...actual, rmSync }
})

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

describe('không bao giờ xoá chính thư mục tạm, home hay gốc ổ', () => {
  it('isTemporaryDir chỉ đúng với thư mục con thật sự của tmpdir', () => {
    expect(isTemporaryDir('/tmp')).toBe(false)
    expect(isTemporaryDir(tmpdir())).toBe(false)
    expect(isTemporaryDir(homedir())).toBe(false)
    const child = mkdtempSync(join(tmpdir(), 'ng-e2e-con-that-'))
    cleaned.push(child)
    expect(isTemporaryDir(child)).toBe(true)
  })

  it('coi /, /tmp, tmpdir() và homedir() là gốc nguy hiểm (so bằng realpath)', () => {
    expect(isProtectedRoot('/')).toBe(true)
    expect(isProtectedRoot('/tmp')).toBe(true)
    expect(isProtectedRoot(tmpdir())).toBe(true)
    expect(isProtectedRoot(homedir())).toBe(true)
    expect(isProtectedRoot(join(tmpdir(), 'ng-e2e-con-that'))).toBe(false)
  })

  it.each(['/tmp', tmpdir(), homedir()])('từ chối prepareDataDir(%s) và không xoá gì', async (dir) => {
    const existed = existsSync(dir)
    await expect(prepareDataDir(dir)).rejects.toThrow(/Từ chối xoá/)
    // Windows không có `/tmp`: điều cần kiểm là không xoá và cũng không tạo mới thư mục bị từ chối.
    expect(existsSync(dir)).toBe(existed)
  })
})
