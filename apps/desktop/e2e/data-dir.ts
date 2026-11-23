import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Quản lý `NEXGRAPH_E2E_DATA_DIR` — thư mục dữ liệu engine dùng lại giữa các lượt E2E.
 *
 * Mỗi lượt phải bắt đầu từ trạng thái sạch, nhưng biến này do người chạy đặt nên có thể trỏ nhầm vào thư mục
 * thật: chỉ xoá khi thư mục nằm dưới thư mục tạm **hoặc** có marker do chính E2E ghi ở lượt trước. Trước khi xoá
 * còn chờ tiến trình của lượt trước (Playwright worker, Electron và engine `--data-dir` đó) thoát hẳn, vì engine
 * còn giữ khoá SQLite thì `rmSync` trên Windows sẽ `EBUSY/EPERM`.
 */
export const DATA_DIR_MARKER = '.nexgraph-e2e-data-dir.json'

const DEFAULT_EXIT_TIMEOUT_MS = 20_000
const POLL_MS = 200
const DEFAULT_RETRY_DELAY_MS = 500
const DEFAULT_MAX_RETRIES = 10

export interface DataDirMarker {
  /** PID của Playwright worker và Electron của lượt đã tạo marker. */
  pids: number[]
  createdAt?: string
}

export interface PrepareDataDirOptions {
  /** PID của lượt hiện tại, ghi vào marker để lượt sau chờ. */
  pids?: number[]
  /** Chờ tối đa bao lâu cho tiến trình lượt trước thoát (mặc định 20 s). */
  exitTimeoutMs?: number
  maxRetries?: number
  retryDelayMs?: number
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Thư mục tạm của máy (`TMPDIR`) hoặc `/tmp` trên POSIX (`/tmp` là symlink của `/private/tmp` trên macOS). */
export function isTemporaryDir(dir: string): boolean {
  const target = realOrResolved(dir)
  const roots = process.platform === 'win32' ? [tmpdir()] : [tmpdir(), '/tmp']
  return roots.some((root) => isInside(target, realOrResolved(root)))
}

/** Marker của lượt trước; `null` khi chưa có (thư mục lạ) hoặc tệp hỏng. */
export function readDataDirMarker(dir: string): DataDirMarker | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, DATA_DIR_MARKER), 'utf8')) as Partial<DataDirMarker>
    const pids = Array.isArray(raw.pids) ? raw.pids.filter((pid): pid is number => Number.isInteger(pid) && pid > 1) : []
    return { pids, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined }
  } catch {
    return null
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: tiến trình còn sống nhưng của người dùng khác.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Tiến trình engine còn phục vụ đúng `--data-dir <dir>` (POSIX, dựa vào `ps`).
 * Windows không có `ps`: bỏ qua bước này, dựa vào PID trong marker và retry của `rmSync`.
 */
export function enginePids(dataDir: string): number[] {
  if (process.platform === 'win32') return []
  const out = spawnSync('ps', ['-A', '-o', 'pid=,args='], { encoding: 'utf8' })
  if (out.status !== 0 || !out.stdout) return []
  const wanted = new Set([dataDir, resolve(dataDir), realOrResolved(dataDir)])
  const found: number[] = []
  for (const line of out.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    const args = match[2].split(/\s+/)
    if (!args.includes('--data-dir')) continue
    if (!args.some((arg) => wanted.has(arg))) continue
    if (!/nexgraph_engine|python|uv/.test(match[2])) continue
    found.push(Number(match[1]))
  }
  return found
}

async function waitForPreviousRun(dataDir: string, timeoutMs: number): Promise<void> {
  const pids = readDataDirMarker(dataDir)?.pids ?? []
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const holders = [...new Set([...pids.filter(isAlive), ...enginePids(dataDir)])]
    if (holders.length === 0) return
    if (Date.now() >= deadline) {
      throw new Error(
        `Không xoá ${dataDir}: lượt E2E trước còn tiến trình giữ thư mục (pid ${holders.join(', ')}). ` +
          'Dừng tiến trình đó rồi chạy lại; nếu chắc chắn không còn ai dùng thì xoá thư mục bằng tay.'
      )
    }
    await new Promise((done) => setTimeout(done, POLL_MS))
  }
}

/**
 * Dọn thư mục dữ liệu engine rồi tạo lại kèm marker.
 *
 * Từ chối (ném lỗi, không xoá gì) khi thư mục đã có dữ liệu nhưng không nằm dưới thư mục tạm và không có marker
 * do E2E tạo — tránh xoá nhầm thư mục thật khi `NEXGRAPH_E2E_DATA_DIR` bị trỏ sai. Trước khi xoá chờ tiến trình
 * của lượt trước thoát; `rmSync` retry mỗi 500 ms để Windows kịp nhả khoá SQLite.
 */
export async function prepareDataDir(dataDir: string, opts: PrepareDataDirOptions = {}): Promise<void> {
  if (existsSync(dataDir)) {
    if (!readDataDirMarker(dataDir) && !isTemporaryDir(dataDir)) {
      throw new Error(
        `Từ chối xoá ${dataDir}: không nằm dưới thư mục tạm (${tmpdir()}) và không có ${DATA_DIR_MARKER} do E2E tạo. ` +
          'Đặt NEXGRAPH_E2E_DATA_DIR vào thư mục tạm, hoặc xoá thủ công nếu chắc chắn đây là dữ liệu E2E.'
      )
    }
    await waitForPreviousRun(dataDir, opts.exitTimeoutMs ?? DEFAULT_EXIT_TIMEOUT_MS)
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: opts.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryDelay: opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    })
  }
  mkdirSync(dataDir, { recursive: true })
  writeMarker(dataDir, opts.pids ?? [])
}

function writeMarker(dataDir: string, pids: number[]): void {
  writeFileSync(join(dataDir, DATA_DIR_MARKER), JSON.stringify({ pids, createdAt: new Date().toISOString() }))
}

/** Ghi thêm PID của app (Electron) sau khi launch: lượt sau chờ cả cây engine của nó thoát. */
export function addDataDirOwner(dataDir: string, pid: number): void {
  const pids = readDataDirMarker(dataDir)?.pids ?? []
  writeMarker(dataDir, [...new Set([...pids, pid])])
}
