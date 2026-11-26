import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path'
import type { EngineCommand } from '../../platform/engine/launcher'

export const BEGIN = '# >>> nexgraph >>>'
export const END = '# <<< nexgraph <<<'
export const HOOKS = ['post-commit', 'post-checkout', 'post-merge', 'post-rewrite'] as const
export type HookName = (typeof HOOKS)[number]
const BLOCKS_RE = new RegExp(`${BEGIN}\\n[\\s\\S]*?${END}\\n?`, 'g')
export type HookStatus = 'no_git' | 'off' | 'on' | 'outdated' | 'outside_repo'

const fail = (code: string, message: string): Error => Object.assign(new Error(message), { code })
const quote = (s: string): string => `'${s.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`
const SHELLS: Record<string, true> = { sh: true, bash: true, dash: true, ksh: true, zsh: true }

function isShellHook(text: string): boolean {
  const shebang = text.match(/^#!\s*(\S+)(?:\s+(.*))?(?:\r?\n|$)/)
  if (!shebang) return false
  const interpreter = basename(shebang[1])
  if (Object.hasOwn(SHELLS, interpreter)) return true
  if (interpreter !== 'env') return false
  const parts = shebang[2]?.trim().split(/\s+/) ?? []
  if (parts[0] === '-S') parts.shift()
  return parts.length > 0 && Object.hasOwn(SHELLS, basename(parts[0]))
}

const isWithin = (child: string, parent: string): boolean => {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

type HooksDir = { dir: string; husky: boolean }

/**
 * Thư mục hook git thật sự chạy: theo core.hooksPath (Husky), worktree và thư mục con; `null` khi không phải kho git.
 * Như graphify hooks.py: Husky 9 (`<x>/_`, mặc định `.husky/_`) ghi vào `<x>/`; core.hooksPath ra ngoài kho thì từ chối.
 */
function hooksDir(projectPath: string): HooksDir | null {
  let out: string
  let root: string
  try {
    // native: Windows mở rộng tên 8.3 (RUNNER~1) để so được với đường dẫn dài mà git trả về.
    root = realpathSync.native(projectPath)
    out = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel', '--git-common-dir', '--git-path', 'hooks'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
    })
  } catch {
    return null
  }
  const [top, common, hooks] = out.trim().split(/\r?\n/)
  if (!top || !common || !hooks) return null
  let dir = resolve(root, hooks)
  const husky = basename(dir) === '_'
  if (husky) dir = dirname(dir)
  if (!isWithin(dir, resolve(top)) && dir !== resolve(root, common, 'hooks')) {
    throw fail('unsupported_hook_path', `core.hooksPath trỏ ra ngoài kho (${dir}), NexGraph không ghi vào đó`)
  }
  return { dir, husky }
}

const needDir = (projectPath: string): HooksDir => {
  const found = hooksDir(projectPath)
  if (!found) throw fail('no_git', 'Dự án không phải kho Git')
  return found
}

/** Nhánh đang checkout để hiện trên thanh tiêu đề; `null` khi không phải kho git, HEAD tách rời hoặc git lỗi. */
export function gitBranch(projectPath: string): string | null {
  try {
    return execFileSync('git', ['-C', projectPath, 'branch', '--show-current'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
    }).trim() || null
  } catch {
    return null
  }
}

/**
 * Chạy nền để lệnh git không chậm đi và không bao giờ thất bại vì NexGraph; luật bỏ qua nằm trong `refresh --hook`.
 * Trạng thái git (rebase/merge/cherry-pick, sequencer) phải chụp đồng bộ ở đây: khi engine khởi động xong thì git đã đi tiếp.
 * Mọi lệnh có thể lỗi đều nằm trong `if`/`|| :` vì Husky chạy tệp bằng `sh -e`.
 */
export function hookBlock(cmd: EngineCommand, projectPath: string, dataDir: string, hook: HookName): string {
  const argv = [cmd.command, ...cmd.args, 'refresh', '--project', projectPath, '--data-dir', dataDir, '--hook', hook].map(quote).join(' ')
  return `${BEGIN}
(
_ng_d=\${GIT_DIR:-$(git rev-parse --git-dir 2>/dev/null || :)}
NEXGRAPH_GIT_STATE= NEXGRAPH_SEQ_TODO= NEXGRAPH_HEAD_SUBJECT=
for _ng_f in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD; do
  if [ -n "$_ng_d" ] && [ -e "$_ng_d/$_ng_f" ]; then NEXGRAPH_GIT_STATE="$NEXGRAPH_GIT_STATE $_ng_f"; fi
done
if [ -n "$_ng_d" ] && [ -f "$_ng_d/sequencer/todo" ]; then
  NEXGRAPH_SEQ_TODO=$(grep . "$_ng_d/sequencer/todo" 2>/dev/null | head -n 2 || :)
  NEXGRAPH_HEAD_SUBJECT=$(git log -1 --format=%s 2>/dev/null || :)
fi
export NEXGRAPH_GIT_STATE NEXGRAPH_SEQ_TODO NEXGRAPH_HEAD_SUBJECT
${argv} "$@" </dev/null >/dev/null 2>&1 &
)
${END}
`
}

export function hookPreview(projectPath: string, cmd: EngineCommand, dataDir: string): string {
  const { dir } = needDir(projectPath)
  return HOOKS.map((h) => `${join(dir, h)}\n${hookBlock(cmd, projectPath, dataDir, h)}`).join('\n')
}

const readHook = (file: string): string | null => (existsSync(file) ? readFileSync(file, 'utf8') : null)
/** Khối của đúng dự án này (thư mục hook có thể dùng chung giữa worktree, thư mục con); khối cũ không ghi --project coi là của mình. */
const ownBlock = (text: string | null, projectPath: string): string | undefined => {
  const blocks = text?.match(BLOCKS_RE) ?? []
  return blocks.find((b) => b.includes(`'--project' ${quote(projectPath)} `)) ?? blocks.find((b) => !b.includes(`'--project' `))
}

export function hookStatus(projectPath: string, cmd: EngineCommand, dataDir: string): HookStatus {
  let found0: HooksDir | null
  try {
    found0 = hooksDir(projectPath)
  } catch (e) {
    if ((e as { code?: string }).code === 'unsupported_hook_path') return 'outside_repo'
    throw e
  }
  if (!found0) return 'no_git'
  const { dir } = found0
  const found = HOOKS.map((h) => ownBlock(readHook(join(dir, h)), projectPath))
  if (found.every((b) => b === undefined)) return 'off'
  return found.every((b, i) => b === hookBlock(cmd, projectPath, dataDir, HOOKS[i])) ? 'on' : 'outdated'
}

export function installHook(projectPath: string, cmd: EngineCommand, dataDir: string): void {
  const { dir, husky } = needDir(projectPath)
  const texts = HOOKS.map((h) => {
    const file = join(dir, h)
    // Tệp hook là symlink (commit sẵn trong repo) có thể trỏ ra ngoài kho: không ghi xuyên qua.
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw fail('unsupported_hook', `Hook ${h} là liên kết tượng trưng`)
    const text = readHook(file)
    // Husky chạy tệp người dùng bằng `sh -e`, nên tệp không có shebang vẫn là shell.
    if (text !== null && !isShellHook(text) && !(husky && !text.startsWith('#!'))) throw fail('unsupported_hook', `Hook ${h} hiện có không dùng shell tương thích`)
    return text ?? '#!/bin/sh\n'
  })
  mkdirSync(dir, { recursive: true })
  HOOKS.forEach((h, i) => {
    const block = hookBlock(cmd, projectPath, dataDir, h)
    let text = texts[i]
    const own = ownBlock(text, projectPath)
    if (own) text = text.replace(own, () => block)
    else text = `${text.endsWith('\n') ? text : `${text}\n`}${block}`
    const file = join(dir, h)
    writeFileSync(file, text)
    chmodSync(file, 0o755)
  })
}

export function uninstallHook(projectPath: string): void {
  const found = hooksDir(projectPath)
  if (!found) return
  for (const h of HOOKS) {
    const file = join(found.dir, h)
    const text = readHook(file)
    // Thư mục hook dùng chung giữa các worktree: chỉ gỡ khối của chính dự án này.
    const own = ownBlock(text, projectPath)
    if (text === null || !own) continue
    const rest = text.replace(own, '')
    if (rest.trim() === '' || rest.trim() === '#!/bin/sh') unlinkSync(file)
    else writeFileSync(file, rest)
  }
}
