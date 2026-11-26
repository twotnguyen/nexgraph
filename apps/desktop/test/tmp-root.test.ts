import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import setup from './global-tmp'

// MIN-tmp-leak: test tạo `mkdtemp(tmpdir(), 'ng-…')` mà không dọn từng để lại ~430 thư mục mỗi lượt chạy.
// Thư mục tạm của test phải nằm trong thư mục gốc riêng của lượt vitest (test/global-tmp.ts), được xoá khi
// lượt chạy kết thúc — kể cả thư mục do tiến trình con của test tạo ra.
describe('thư mục tạm của lượt test', () => {
  it('os.tmpdir() trong test là thư mục gốc riêng của lượt vitest', () => {
    expect(basename(tmpdir())).toMatch(/^ngv-\d+$/)
  })

  it('tiến trình con của test thấy cùng thư mục tạm', () => {
    const child = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").tmpdir())'], { encoding: 'utf8' })
    expect(child).toBe(tmpdir())
  })

  it('teardown xoá thư mục gốc và trả biến môi trường; lượt sau dọn gốc của lượt đã chết', () => {
    const base = tmpdir()
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid
    const dead = join(base, `ngv-${deadPid}`)
    const live = join(base, `ngv-${process.ppid}`)  // tiến trình cha còn sống
    mkdirSync(join(dead, 'ng-sess-x'), { recursive: true })
    mkdirSync(live)

    const teardown = setup()
    const root = process.env.TMPDIR as string
    try {
      expect(dirname(root)).toBe(base)
      expect(process.env.TEMP).toBe(root)
      expect(process.env.TMP).toBe(root)
      expect(existsSync(dead)).toBe(false)
      expect(existsSync(live)).toBe(true)
      mkdirSync(join(root, 'ng-task-ro'))
    } finally {
      teardown()
    }
    expect(existsSync(root)).toBe(false)
    expect(process.env.TMPDIR).toBe(base)
  })
})
