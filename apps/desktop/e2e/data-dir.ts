import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Quản lý `NEXGRAPH_E2E_DATA_DIR` — thư mục dữ liệu engine dùng lại giữa các lượt E2E.
 *
 * Mỗi lượt phải bắt đầu từ trạng thái sạch, nhưng biến này do người chạy đặt nên có thể trỏ nhầm vào thư mục
 * thật: chỉ xoá khi thư mục nằm dưới thư mục tạm **hoặc** có marker do chính E2E ghi ở lượt trước.
 */
export const DATA_DIR_MARKER = '.nexgraph-e2e-data-dir.json'

const MAX_RETRIES = 3

export interface DataDirMarker {
  /** PID của Playwright worker và Electron của lượt đã tạo marker. */
  pids: number[]
  createdAt?: string
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

/**
 * Dọn thư mục dữ liệu engine rồi tạo lại kèm marker.
 *
 * Từ chối (ném lỗi, không xoá gì) khi thư mục đã có dữ liệu nhưng không nằm dưới thư mục tạm và không có marker
 * do E2E tạo — tránh xoá nhầm thư mục thật khi `NEXGRAPH_E2E_DATA_DIR` bị trỏ sai.
 */
export async function prepareDataDir(dataDir: string, pids: number[] = []): Promise<void> {
  if (existsSync(dataDir)) {
    if (!readDataDirMarker(dataDir) && !isTemporaryDir(dataDir)) {
      throw new Error(
        `Từ chối xoá ${dataDir}: không nằm dưới thư mục tạm (${tmpdir()}) và không có ${DATA_DIR_MARKER} do E2E tạo. ` +
          'Đặt NEXGRAPH_E2E_DATA_DIR vào thư mục tạm, hoặc xoá thủ công nếu chắc chắn đây là dữ liệu E2E.'
      )
    }
    rmSync(dataDir, { recursive: true, force: true, maxRetries: MAX_RETRIES })
  }
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, DATA_DIR_MARKER), JSON.stringify({ pids, createdAt: new Date().toISOString() }))
}
