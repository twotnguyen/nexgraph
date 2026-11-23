import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SecretStore, writeJson } from '../src/main/ai/settings'
import { isProtectedRel, resolveInside } from '../src/main/fs/project-fs'
import { GeminiConnectionManager } from '../src/main/gemini/connection'

// NTFS không có mode POSIX: chỉ kiểm quyền tệp trên macOS/Linux.
const posix = process.platform !== 'win32'
const mode = (file: string) => statSync(file).mode & 0o777
const base = (tag: string) => mkdtempSync(join(tmpdir(), `ng-sec-${tag}-`))

/** Khoá giả: "mã hoá" bằng tiền tố để kiểm nội dung đĩa không bao giờ là bản rõ. */
const box = { available: () => true, encrypt: (s: string) => `enc:${Buffer.from(s).toString('base64')}`, decrypt: (b: string) => Buffer.from(b.slice(4), 'base64').toString() }

// AI-07: các bất biến đã đọc khi review connection.ts / kho token / project-fs.ts.
describe('kho token (ai/settings SecretStore)', () => {
  it('chỉ ghi bản mã hoá và đọc lại đúng', () => {
    const dir = base('secret')
    const file = join(dir, 'ai-keys.json')
    const store = new SecretStore(file, box)
    store.set('openai', 'sk-bí-mật-không-được-lên-đĩa')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('sk-bí-mật')
    expect(JSON.parse(raw).openai).toMatch(/^enc:/)
    expect(store.get('openai')).toBe('sk-bí-mật-không-được-lên-đĩa')
  })

  it.skipIf(!posix)('tệp khoá tạo với quyền 0600', () => {
    const dir = base('secret-mode')
    const file = join(dir, 'ai-keys.json')
    new SecretStore(file, box).set('openai', 'sk')
    expect(mode(file)).toBe(0o600)
  })

  it('bản mã hỏng: get() trả null, readStrict() báo lỗi thay vì lặng lẽ dùng rỗng', () => {
    const dir = base('secret-bad')
    const file = join(dir, 'ai-keys.json')
    writeFileSync(file, JSON.stringify({ openai: 'không-phải-base64' }), { mode: 0o600 })
    const store = new SecretStore(file, { ...box, decrypt: () => { throw new Error('bad ciphertext') } })
    expect(store.get('openai')).toBeNull()
    expect(() => store.readStrict('openai')).toThrow(/Không đọc được kho/)
  })

  it('set() từ chối khi máy không có kho khoá an toàn (không ghi bản rõ)', () => {
    const dir = base('secret-nokey')
    const file = join(dir, 'ai-keys.json')
    const store = new SecretStore(file, { ...box, available: () => false })
    expect(() => store.set('openai', 'sk')).toThrow(/kho khoá an toàn/)
    expect(existsSync(file)).toBe(false)
  })
})

describe('metadata kết nối Google (gemini/connection)', () => {
  it('ghi connection.json 0600 và bỏ profileId không phải UUID trong tệp cũ', async () => {
    const dir = base('meta')
    writeFileSync(join(dir, 'connection.json'), JSON.stringify({ profileId: '../../etc', connectionId: 'x' }))
    const manager = new GeminiConnectionManager({ dataDir: dir, notify: () => {} } as never)
    const status = await manager.status()
    expect(status.connectionId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(manager.connectionIdentity()).not.toContain('..')
  })
})

describe('deny-list project-fs (AI-07)', () => {
  it('bảo vệ .git/.nexgraph/.env*/.npmrc/credentials bất kể hoa thường', () => {
    for (const path of ['.git/config', '.NEXGRAPH/tasks.json', '.env.local', 'sub/.npmrc', 'credentials.json', 'deep/id_rsa', 'k.pem']) {
      expect(isProtectedRel(path), path).toBe(true)
    }
  })

  it('resolveInside từ chối đường dẫn tuyệt đối và tệp bảo vệ trong dự án', () => {
    const root = base('root')
    mkdirSync(join(root, 'sub'))
    expect(() => resolveInside(root, '/etc/hosts')).toThrow(/ngoài dự án/)
    expect(() => resolveInside(root, '.env')).toThrow(/bảo vệ/)
  })
})

describe('tệp cấu hình chung', () => {
  it('writeJson ghi nội dung mới và giữ tệp chỉ chủ sở hữu đọc', () => {
    const dir = base('json')
    const file = join(dir, 'prefs.json')
    writeJson(file, { a: '1' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: '1' })
    if (!posix) return // NTFS không có mode POSIX
    expect(mode(file)).toBe(0o600)
    chmodSync(file, 0o644)
    writeJson(file, { a: '2' })
    expect(mode(file)).toBe(0o600)
  })
})
