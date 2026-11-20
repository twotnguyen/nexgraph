import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SecretStore } from '../../src/main/ai/settings'
import { IndexSourceStore } from '../../src/main/index-sources'

const box = { available: () => true, encrypt: (s: string) => Buffer.from(s).toString('base64').split('').reverse().join(''),
  decrypt: (b: string) => Buffer.from(b.split('').reverse().join(''), 'base64').toString() }
const DSN = 'postgresql://u:matkhau-bi-mat@h/db'

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'ng-src-'))
  return { dir, s: new IndexSourceStore(join(dir, 'index-sources.json'), new SecretStore(join(dir, 'secrets.json'), box)) }
}

describe('IndexSourceStore', () => {
  it('không có nguồn thì giữ nguyên tuỳ chọn', () => {
    const { s } = store()
    expect(s.resolve('p1', { force: true })).toEqual({ opts: { force: true } })
    expect(s.resolve('p1')).toEqual({ opts: undefined })
  })

  it('nhớ nguồn của hộp thoại và dùng lại khi nút Index lại không gửi', () => {
    const { s } = store()
    s.resolve('p1', { sources: { cargo: true, scipFiles: ['/a/index.scip.json'] } })
    expect(s.resolve('p1')).toEqual({ opts: { sources: { cargo: true, scipFiles: ['/a/index.scip.json'] } } })
    expect(s.resolve('p2')).toEqual({ opts: undefined })
    expect(s.remembered('p1')).toEqual({ cargo: true, scipFiles: ['/a/index.scip.json'] })
  })

  it('chỉ gắn DSN khi bật PostgreSQL; DSN không ở dạng rõ trên đĩa', () => {
    const { s, dir } = store()
    expect(s.hasDsn('p1')).toBe(false)
    s.saveDsn('p1', DSN)
    expect(s.hasDsn('p1')).toBe(true)
    expect(s.resolve('p1', { sources: { postgres: true } }).postgresDsn).toBe(DSN)
    expect(s.resolve('p1', { sources: { cargo: true } }).postgresDsn).toBeUndefined()
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8')).not.toContain('matkhau-bi-mat')
    s.saveDsn('p1', null)
    expect(s.hasDsn('p1')).toBe(false)
  })
})
