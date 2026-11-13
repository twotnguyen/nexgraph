import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { EngineCommand } from './engine/launcher'

export const BEGIN = '# >>> nexgraph >>>'
export const END = '# <<< nexgraph <<<'
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

const hookPath = (projectPath: string): string => join(projectPath, '.git', 'hooks', 'post-commit')
const isGitRepo = (projectPath: string): boolean => {
  try {
    return statSync(join(projectPath, '.git')).isDirectory()
  } catch {
    return false
  }
}

/** Chạy nền để commit không chậm đi và không bao giờ thất bại vì NexGraph. */
export function hookBlock(cmd: EngineCommand, projectPath: string, dataDir: string): string {
  const argv = [cmd.command, ...cmd.args, 'refresh', '--project', projectPath, '--data-dir', dataDir].map(quote).join(' ')
  return `${BEGIN}\n( ${argv} >/dev/null 2>&1 & )\n${END}\n`
}

export function hookStatus(projectPath: string, cmd: EngineCommand, dataDir: string): HookStatus {
  if (!isGitRepo(projectPath)) return 'no_git'
  const file = hookPath(projectPath)
  if (!existsSync(file)) return 'off'
  const found = readFileSync(file, 'utf8').match(BLOCK_RE)
  if (!found) return 'off'
  return found[0] === hookBlock(cmd, projectPath, dataDir) ? 'on' : 'outdated'
}

export function installHook(projectPath: string, cmd: EngineCommand, dataDir: string): void {
  if (!isGitRepo(projectPath)) throw fail('no_git', 'Dự án không phải kho Git')
  const file = hookPath(projectPath)
  const block = hookBlock(cmd, projectPath, dataDir)
  let text: string
  if (existsSync(file)) {
    text = readFileSync(file, 'utf8')
    if (!isShellHook(text)) throw fail('unsupported_hook', 'Hook post-commit hiện có không dùng shell tương thích')
  } else {
    text = '#!/bin/sh\n'
  }
  if (BLOCK_RE.test(text)) text = text.replace(BLOCK_RE, () => block)
  else text = `${text.endsWith('\n') ? text : `${text}\n`}${block}`
  writeFileSync(file, text)
  chmodSync(file, 0o755)
}

export function uninstallHook(projectPath: string): void {
  const file = hookPath(projectPath)
  if (!existsSync(file)) return
  const rest = readFileSync(file, 'utf8').replace(BLOCK_RE, '')
  if (rest.trim() === '' || rest.trim() === '#!/bin/sh') unlinkSync(file)
  else writeFileSync(file, rest)
}
