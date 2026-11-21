import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { BEGIN, HOOKS, hookBlock, hookPreview, hookStatus, installHook, uninstallHook } from '../src/main/git-hook'

const cmd = { command: '/Apps/NexGraph/engine', args: [] as string[] }
const dataDir = '/d'
const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
const newRepo = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ng-hook-')))
  git(dir, 'init', '-q')
  return dir
}
const readHook = (f: string): string | null => (existsSync(f) ? readFileSync(f, 'utf8') : null)
let root: string
let hook: string
beforeEach(() => {
  root = newRepo()
  hook = join(root, '.git', 'hooks', 'post-commit')
})

describe('git hook', () => {
  it('cài vào kho chưa có hook: đủ 4 tệp chạy được, trạng thái on', () => {
    installHook(root, cmd, dataDir)
    for (const name of HOOKS) {
      const file = join(root, '.git', 'hooks', name)
      const text = readFileSync(file, 'utf8')
      expect(text.startsWith('#!/bin/sh\n')).toBe(true)
      expect(text).toContain(BEGIN)
      expect(text).toContain(`'--hook' '${name}' "$@"`)
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o111).not.toBe(0) // Windows không có bit thực thi
    }
    expect(hookStatus(root, cmd, dataDir)).toBe('on')
  })

  it('hook có sẵn nội dung khác: giữ nguyên, thêm khối ở cuối; gỡ thì trả lại y nguyên', () => {
    writeFileSync(hook, '#!/bin/sh\nnpx husky run\n', { mode: 0o755 })
    installHook(root, cmd, dataDir)
    expect(readFileSync(hook, 'utf8')).toContain('npx husky run')
    uninstallHook(root)
    expect(readFileSync(hook, 'utf8')).toBe('#!/bin/sh\nnpx husky run\n')
    for (const name of HOOKS.slice(1)) expect(existsSync(join(root, '.git', 'hooks', name))).toBe(false)
  })

  it.each([
    '#!/usr/bin/python3\nprint("hook")\n',
    '#!/usr/bin/env python3\nprint("hook")\n',
    '#!/usr/bin/node\nconsole.log("hook")\n',
    '#!/usr/bin/env node\nconsole.log("hook")\n'
  ])('một hook không phải shell: từ chối, không tệp nào đổi bytes hoặc mode', (original) => {
    const merge = join(root, '.git', 'hooks', 'post-merge')
    writeFileSync(merge, original, { mode: 0o640 })
    chmodSync(merge, 0o640)
    const mode = statSync(merge).mode & 0o777

    expect(() => installHook(root, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'unsupported_hook' }))
    expect(readFileSync(merge, 'utf8')).toBe(original)
    expect(statSync(merge).mode & 0o777).toBe(mode)
    expect(existsSync(hook)).toBe(false)
  })

  it('chấp nhận hook bash hiện có', () => {
    writeFileSync(hook, '#!/usr/bin/env bash\necho existing\n', { mode: 0o755 })
    installHook(root, cmd, dataDir)
    expect(readFileSync(hook, 'utf8')).toContain(BEGIN)
  })

  it('gỡ khỏi tệp chỉ có khối nexgraph thì xoá tệp', () => {
    installHook(root, cmd, dataDir)
    uninstallHook(root)
    for (const name of HOOKS) expect(existsSync(join(root, '.git', 'hooks', name))).toBe(false)
    expect(hookStatus(root, cmd, dataDir)).toBe('off')
  })

  it('cài hai lần không nhân đôi khối; đường dẫn engine đổi thì status outdated và cài lại thay khối', () => {
    installHook(root, cmd, dataDir)
    installHook(root, cmd, dataDir)
    expect(readFileSync(hook, 'utf8').split(BEGIN).length - 1).toBe(1)
    const moved = { command: '/New/engine', args: [] as string[] }
    expect(hookStatus(root, moved, dataDir)).toBe('outdated')
    installHook(root, moved, dataDir)
    expect(readFileSync(hook, 'utf8')).toContain('/New/engine')
    expect(readFileSync(hook, 'utf8')).not.toContain('/Apps/NexGraph/engine')
    expect(hookStatus(root, moved, dataDir)).toBe('on')
  })

  it('bản cài cũ chỉ có post-commit: outdated, cài lại thì đủ 4', () => {
    writeFileSync(hook, `#!/bin/sh\n${BEGIN}\n( 'old' >/dev/null 2>&1 & )\n# <<< nexgraph <<<\n`, { mode: 0o755 })
    expect(hookStatus(root, cmd, dataDir)).toBe('outdated')
    installHook(root, cmd, dataDir)
    expect(hookStatus(root, cmd, dataDir)).toBe('on')
    expect(readFileSync(hook, 'utf8')).not.toContain("'old'")
  })

  it('core.hooksPath trong kho được tôn trọng', () => {
    git(root, 'config', 'core.hooksPath', '.githooks')
    installHook(root, cmd, dataDir)
    expect(readFileSync(join(root, '.githooks', 'post-rewrite'), 'utf8')).toContain(BEGIN)
    expect(existsSync(hook)).toBe(false)
    expect(hookPreview(root, cmd, dataDir)).toContain(join(root, '.githooks', 'post-merge'))
  })

  it('Husky 9 (.husky/_): ghi vào .husky/ để Husky không ghi đè', () => {
    mkdirSync(join(root, '.husky', '_'), { recursive: true })
    git(root, 'config', 'core.hooksPath', '.husky/_')
    installHook(root, cmd, dataDir)
    expect(readFileSync(join(root, '.husky', 'post-commit'), 'utf8')).toContain(BEGIN)
    expect(existsSync(join(root, '.husky', '_', 'post-commit'))).toBe(false)
  })

  it('Husky: tệp người dùng không có shebang (Husky chạy bằng sh -e) được chấp nhận và giữ nguyên', () => {
    mkdirSync(join(root, '.husky', '_'), { recursive: true })
    git(root, 'config', 'core.hooksPath', '.husky/_')
    writeFileSync(join(root, '.husky', 'post-merge'), 'echo husky-user-post-merge\n')
    installHook(root, cmd, dataDir)
    const text = readFileSync(join(root, '.husky', 'post-merge'), 'utf8')
    expect(text.startsWith('echo husky-user-post-merge\n')).toBe(true)
    expect(text).toContain(BEGIN)
    uninstallHook(root)
    expect(readFileSync(join(root, '.husky', 'post-merge'), 'utf8')).toBe('echo husky-user-post-merge\n')
  })

  it('Husky đặt ở thư mục khác (.config/husky/_): vẫn ghi vào thư mục cha', () => {
    mkdirSync(join(root, '.config', 'husky', '_'), { recursive: true })
    git(root, 'config', 'core.hooksPath', '.config/husky/_')
    installHook(root, cmd, dataDir)
    expect(readFileSync(join(root, '.config', 'husky', 'post-commit'), 'utf8')).toContain(BEGIN)
  })

  it('core.hooksPath ngoài kho: từ chối, không ghi; status outside_repo thay vì ném lỗi', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ng-global-hooks-'))
    git(root, 'config', 'core.hooksPath', outside)
    expect(() => installHook(root, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'unsupported_hook_path' }))
    expect(existsSync(join(outside, 'post-commit'))).toBe(false)
    expect(hookStatus(root, cmd, dataDir)).toBe('outside_repo')
  })

  it('gỡ ở worktree chỉ gỡ khối của chính dự án đó, giữ khối của dự án chính', () => {
    git(root, 'commit', '-q', '--allow-empty', '-m', 'x')
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'ng-wt-'))), 'wt')
    git(root, 'worktree', 'add', '-q', wt)
    installHook(root, cmd, dataDir)
    uninstallHook(wt)
    expect(hookStatus(root, cmd, dataDir)).toBe('on')
  })

  it('worktree (.git là tệp) và thư mục con: ghi vào hook chung của kho', () => {
    git(root, 'commit', '-q', '--allow-empty', '-m', 'x')
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'ng-wt-'))), 'wt')
    git(root, 'worktree', 'add', '-q', wt)
    installHook(wt, cmd, dataDir)
    expect(readFileSync(hook, 'utf8')).toContain(`'${wt}'`)
    expect(hookStatus(wt, cmd, dataDir)).toBe('on')
    mkdirSync(join(root, 'sub'))
    expect(hookStatus(join(root, 'sub'), cmd, dataDir)).toBe('off')
  })

  it('hai dự án chung thư mục hook: mỗi dự án có khối riêng, cài/gỡ không đè nhau', () => {
    const sub = join(root, 'sub')
    mkdirSync(sub)
    installHook(root, cmd, dataDir)
    installHook(sub, cmd, dataDir)
    expect(readFileSync(hook, 'utf8').split(BEGIN).length - 1).toBe(2)
    expect(hookStatus(root, cmd, dataDir)).toBe('on')
    expect(hookStatus(sub, cmd, dataDir)).toBe('on')
    installHook(root, cmd, dataDir)
    expect(readFileSync(hook, 'utf8').split(BEGIN).length - 1).toBe(2)
    uninstallHook(sub)
    expect(hookStatus(sub, cmd, dataDir)).toBe('off')
    expect(hookStatus(root, cmd, dataDir)).toBe('on')
  })

  it.skipIf(process.platform === 'win32')('tệp hook là symlink: từ chối, không ghi xuyên qua', () => {
    const target = join(realpathSync(mkdtempSync(join(tmpdir(), 'ng-out-'))), 'rc')
    writeFileSync(target, '#!/bin/sh\n')
    mkdirSync(join(root, '.git', 'hooks'), { recursive: true })
    symlinkSync(target, hook)
    expect(() => installHook(root, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'unsupported_hook' }))
    expect(readFileSync(target, 'utf8')).toBe('#!/bin/sh\n')
  })

  it.skipIf(process.platform === 'win32')('git thật gọi khối hook ở nền với tên hook và đối số của git', async () => {
    const log = join(root, 'calls.log')
    const rec = { command: '/bin/sh', args: ['-c', `echo "$*" >> '${log}'`, 'engine'] } // quote() đổi \ thành /, nên không dùng printf '\n'
    installHook(root, rec, dataDir)
    git(root, 'commit', '-q', '--allow-empty', '-m', 'a')
    git(root, 'checkout', '-q', '-b', 'b')
    const deadline = Date.now() + 3000
    while (Date.now() < deadline && (readHook(log)?.split('\n').length ?? 0) < 3) await new Promise((r) => setTimeout(r, 50))
    const lines = (readHook(log) ?? '').trim().split('\n').sort()
    expect(lines[0]).toMatch(new RegExp(`^refresh --project ${root} --data-dir /d --hook post-checkout [0-9a-f]{40} [0-9a-f]{40} 1$`))
    expect(lines[1]).toBe(`refresh --project ${root} --data-dir /d --hook post-commit`)
  })

  const enginePython = join(process.cwd(), '..', '..', 'engine', '.venv', 'bin', 'python')
  it.skipIf(process.platform === 'win32' || !existsSync(enginePython))(
    'khối hook thật chạy nền: cherry-pick dải 4 commit ghi cherry_pick cho 3 bước đầu (trạng thái chụp trước khi tách nền)',
    async () => {
      const data = realpathSync(mkdtempSync(join(tmpdir(), 'ng-hook-data-')))
      git(root, 'commit', '-q', '--allow-empty', '-m', 'base')
      git(root, 'checkout', '-q', '-b', 'src')
      for (const n of ['a', 'b', 'c', 'd']) {
        writeFileSync(join(root, `${n}.txt`), n)
        git(root, 'add', `${n}.txt`)
        git(root, 'commit', '-q', '-m', `add ${n}`)
      }
      git(root, 'checkout', '-q', '-')
      installHook(root, { command: enginePython, args: ['-m', 'nexgraph_engine.cli'] }, data)
      git(root, 'cherry-pick', 'HEAD..src')
      const log = join(data, 'logs', 'refresh.log')
      const commits = (): string[] => (readHook(log) ?? '').split('\n').filter((l) => l.split(' ')[1] === 'post-commit')
      const deadline = Date.now() + 25000
      while (Date.now() < deadline && commits().length < 4) await new Promise((r) => setTimeout(r, 100))
      const reasons = commits().map((l) => (JSON.parse(l.split(' ').slice(2).join(' ')) as { reason?: string }).reason ?? 'refresh')
      expect(reasons.sort()).toEqual(['cherry_pick', 'cherry_pick', 'cherry_pick', 'refresh'])
    },
    30000
  )

  it('đường dẫn có nháy đơn và khoảng trắng được escape đúng', () => {
    expect(hookBlock(cmd, "/x/Đồ án/it's", '/d', 'post-commit')).toContain(`'/x/Đồ án/it'\\''s'`)
  })

  it('không phải kho git: no_git, install ném {code:"no_git"}', () => {
    const plain = mkdtempSync(join(tmpdir(), 'ng-nogit-'))
    expect(hookStatus(plain, cmd, dataDir)).toBe('no_git')
    expect(() => installHook(plain, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'no_git' }))
    expect(() => uninstallHook(plain)).not.toThrow()
  })
})
