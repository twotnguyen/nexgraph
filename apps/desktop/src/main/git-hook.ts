import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path'
import type { EngineCommand } from './engine/launcher'

export const BEGIN = '# >>> nexgraph >>>'
export const END = '# <<< nexgraph <<<'
export const HOOKS = ['post-commit', 'post-checkout', 'post-merge', 'post-rewrite'] as const
export type HookName = (typeof HOOKS)[number]
const BLOCK_RE = new RegExp(`${BEGIN}\\n[\\s\\S]*?${END}\\n?`)
export type HookStatus = 'no_git' | 'off' | 'on' | 'outdated'

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

/**
 * Thư mục hook git thật sự chạy: theo core.hooksPath (Husky), worktree và thư mục con; `null` khi không phải kho git.
 * Như graphify hooks.py: Husky 9 (`.husky/_`) ghi vào `.husky/`; core.hooksPath ra ngoài kho thì từ chối.
 */
function hooksDir(projectPath: string): string | null {
  let out: string
  let root: string
  try {
    root = realpathSync(projectPath)
    out = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel', '--git-common-dir', '--git-path', 'hooks'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
    })
  } catch {
    return null
  }
  const [top, common, hooks] = out.trim().split(/\r?\n/)
  if (!top || !common || !hooks) return null
  let dir = resolve(root, hooks)
  if (basename(dir) === '_' && basename(dirname(dir)) === '.husky') dir = dirname(dir)
  if (!isWithin(dir, resolve(top)) && dir !== resolve(root, common, 'hooks')) {
    throw fail('unsupported_hook_path', `core.hooksPath trỏ ra ngoài kho (${dir}), NexGraph không ghi vào đó`)
  }
  return dir
}

/** Chạy nền để lệnh git không chậm đi và không bao giờ thất bại vì NexGraph; luật bỏ qua nằm trong `refresh --hook`. */
export function hookBlock(cmd: EngineCommand, projectPath: string, dataDir: string, hook: HookName): string {
  const argv = [cmd.command, ...cmd.args, 'refresh', '--project', projectPath, '--data-dir', dataDir, '--hook', hook].map(quote).join(' ')
  return `${BEGIN}\n( ${argv} "$@" </dev/null >/dev/null 2>&1 & )\n${END}\n`
}

export function hookPreview(projectPath: string, cmd: EngineCommand, dataDir: string): string {
  const dir = hooksDir(projectPath)
  if (!dir) throw fail('no_git', 'Dự án không phải kho Git')
  return HOOKS.map((h) => `${join(dir, h)}\n${hookBlock(cmd, projectPath, dataDir, h)}`).join('\n')
}

const readHook = (file: string): string | null => (existsSync(file) ? readFileSync(file, 'utf8') : null)

export function hookStatus(projectPath: string, cmd: EngineCommand, dataDir: string): HookStatus {
  const dir = hooksDir(projectPath)
  if (!dir) return 'no_git'
  const found = HOOKS.map((h) => readHook(join(dir, h))?.match(BLOCK_RE)?.[0])
  if (found.every((b) => b === undefined)) return 'off'
  return found.every((b, i) => b === hookBlock(cmd, projectPath, dataDir, HOOKS[i])) ? 'on' : 'outdated'
}

export function installHook(projectPath: string, cmd: EngineCommand, dataDir: string): void {
  const dir = hooksDir(projectPath)
  if (!dir) throw fail('no_git', 'Dự án không phải kho Git')
  const texts = HOOKS.map((h) => {
    const text = readHook(join(dir, h))
    if (text !== null && !isShellHook(text)) throw fail('unsupported_hook', `Hook ${h} hiện có không dùng shell tương thích`)
    return text ?? '#!/bin/sh\n'
  })
  mkdirSync(dir, { recursive: true })
  HOOKS.forEach((h, i) => {
    const block = hookBlock(cmd, projectPath, dataDir, h)
    let text = texts[i]
    if (BLOCK_RE.test(text)) text = text.replace(BLOCK_RE, () => block)
    else text = `${text.endsWith('\n') ? text : `${text}\n`}${block}`
    const file = join(dir, h)
    writeFileSync(file, text)
    chmodSync(file, 0o755)
  })
}

export function uninstallHook(projectPath: string): void {
  const dir = hooksDir(projectPath)
  if (!dir) return
  for (const h of HOOKS) {
    const file = join(dir, h)
    const text = readHook(file)
    if (text === null || !BLOCK_RE.test(text)) continue
    const rest = text.replace(BLOCK_RE, '')
    if (rest.trim() === '' || rest.trim() === '#!/bin/sh') unlinkSync(file)
    else writeFileSync(file, rest)
  }
}
