import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const KEYS = ['TMPDIR', 'TMP', 'TEMP'] as const
// Tên ngắn có chủ ý: đường dẫn socket Unix tối đa 103 ký tự trên macOS, và test tạo socket sâu bên trong
// (`…/T/ngv-<pid>/ng-fs-ops-xxxxxx/project/src/socket` ≈ 94 ký tự; tên dài hơn làm listen() lỗi EINVAL).
const ROOT = /^ngv-(\d+)$/

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

/**
 * Mỗi lượt vitest dùng một thư mục tạm gốc riêng và xoá nó khi lượt chạy kết thúc (MIN-tmp-leak).
 *
 * Nhiều test tạo `mkdtemp(tmpdir(), 'ng-…')` mà không dọn: một lượt chạy để lại ~430 thư mục, vài chục lượt
 * thành hàng chục GB trong thư mục tạm của máy. Biến môi trường đổi ở đây (tiến trình chính, trước khi tạo
 * worker) nên `os.tmpdir()` trong worker và trong tiến trình con do test chạy (git, engine, Electron) đều trỏ
 * vào thư mục của lượt này. Lượt bị ngắt giữa chừng không kịp teardown thì lượt sau dọn giúp.
 */
export default function setup(): () => void {
  const base = tmpdir()
  for (const name of readdirSync(base)) {
    const pid = Number(ROOT.exec(name)?.[1])
    if (pid && (pid === process.pid || !alive(pid))) rmSync(join(base, name), { recursive: true, force: true })
  }
  const root = join(base, `ngv-${process.pid}`)  // pid đang sống là duy nhất; trùng pid cũ thì vừa xoá ở trên
  mkdirSync(root)
  const saved = KEYS.map((key) => [key, process.env[key]] as const)
  for (const key of KEYS) process.env[key] = root
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
