import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineCommand } from './engine/launcher'

export const BEGIN = '# >>> nexgraph >>>'
export const END = '# <<< nexgraph <<<'
export type HookStatus = 'no_git' | 'off' | 'on' | 'outdated'

const fail = (code: string, message: string): Error => Object.assign(new Error(message), { code })
const quote = (s: string): string => `'${s.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`
const BLOCK_RE = new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`)

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
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '#!/bin/sh\n'
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
