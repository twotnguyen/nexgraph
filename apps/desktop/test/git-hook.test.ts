import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { BEGIN, hookBlock, hookStatus, installHook, uninstallHook } from '../src/main/git-hook'

const cmd = { command: '/Apps/NexGraph/engine', args: [] as string[] }
const dataDir = '/d'
let root: string
let hook: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ng-hook-'))
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true })
  hook = join(root, '.git', 'hooks', 'post-commit')
})

describe('git hook', () => {
  it('cài vào kho chưa có hook: tệp mới chạy được, trạng thái on', () => {
    installHook(root, cmd, dataDir)
    const text = readFileSync(hook, 'utf8')
    expect(text.startsWith('#!/bin/sh\n')).toBe(true)
    expect(text).toContain(BEGIN)
    expect(statSync(hook).mode & 0o111).not.toBe(0)
    expect(hookStatus(root, cmd, dataDir)).toBe('on')
  })

  it('hook có sẵn nội dung khác: giữ nguyên, thêm khối ở cuối; gỡ thì trả lại y nguyên', () => {
    writeFileSync(hook, '#!/bin/sh\nnpx husky run\n', { mode: 0o755 })
    installHook(root, cmd, dataDir)
    expect(readFileSync(hook, 'utf8')).toContain('npx husky run')
    uninstallHook(root)
    expect(readFileSync(hook, 'utf8')).toBe('#!/bin/sh\nnpx husky run\n')
  })

  it.each([
    '#!/usr/bin/python3\nprint("hook")\n',
    '#!/usr/bin/env python3\nprint("hook")\n',
    '#!/usr/bin/node\nconsole.log("hook")\n',
    '#!/usr/bin/env node\nconsole.log("hook")\n'
  ])('từ chối hook không phải shell mà không thay đổi bytes hoặc mode', (original) => {
    writeFileSync(hook, original, { mode: 0o640 })
    chmodSync(hook, 0o640)
    const mode = statSync(hook).mode & 0o777

    expect(() => installHook(root, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'unsupported_hook' }))
    expect(readFileSync(hook, 'utf8')).toBe(original)
    expect(statSync(hook).mode & 0o777).toBe(mode)
  })

  it('chấp nhận hook bash hiện có', () => {
    writeFileSync(hook, '#!/usr/bin/env bash\necho existing\n', { mode: 0o755 })
    installHook(root, cmd, dataDir)
    expect(readFileSync(hook, 'utf8')).toContain(BEGIN)
  })

  it('gỡ khỏi tệp chỉ có khối nexgraph thì xoá tệp', () => {
    installHook(root, cmd, dataDir)
    uninstallHook(root)
    expect(existsSync(hook)).toBe(false)
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

  it('đường dẫn có nháy đơn và khoảng trắng được escape đúng', () => {
    expect(hookBlock(cmd, "/x/Đồ án/it's", '/d')).toContain(`'/x/Đồ án/it'\\''s'`)
  })

  it('không phải kho git: no_git, install ném {code:"no_git"}', () => {
    const plain = mkdtempSync(join(tmpdir(), 'ng-nogit-'))
    expect(hookStatus(plain, cmd, dataDir)).toBe('no_git')
    expect(() => installHook(plain, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'no_git' }))
  })
})
