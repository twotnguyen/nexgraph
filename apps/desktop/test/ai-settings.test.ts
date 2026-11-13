import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AiSettingsStore, endpoint, type SecretBox } from '../src/main/ai/settings'

const box: SecretBox = {
  available: () => true,
  encrypt: (s) => Buffer.from([...s].reverse().join('')).toString('base64'),
  decrypt: (b) => [...Buffer.from(b, 'base64').toString()].reverse().join('')
}
let prefs: string
let keys: string
let s: AiSettingsStore
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ng-ai-'))
  prefs = join(dir, 'prefs.json')
  keys = join(dir, 'ai-key.json')
  s = new AiSettingsStore(prefs, keys, box)
})

describe('AiSettingsStore', () => {
  it('lưu và đọc lại; key không nằm dạng rõ trên đĩa', () => {
    expect(s.get()).toEqual({ baseUrl: '', model: '', hasKey: false })
    expect(s.save({ baseUrl: 'https://api.example.com/v1/', model: 'm1', apiKey: 'sk-secret' }))
      .toEqual({ baseUrl: 'https://api.example.com/v1/', model: 'm1', hasKey: true })
    expect(readFileSync(keys, 'utf8')).not.toContain('sk-secret')
    expect(readFileSync(prefs, 'utf8')).not.toContain('sk-secret')
    expect(new AiSettingsStore(prefs, keys, box).key()).toBe('sk-secret')
    s.save({ baseUrl: 'https://api.example.com/v1', model: 'm2' })
    expect(s.key()).toBe('sk-secret') // vắng apiKey = giữ
    s.save({ baseUrl: 'https://api.example.com/v1', model: 'm2', apiKey: '' })
    expect(s.get().hasKey).toBe(false)
  })

  it('đổi nhà cung cấp thì xoá key cũ, nhưng giữ key khi cùng origin và nhận key thay thế', () => {
    s.save({ baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'old-key' })
    s.save({ baseUrl: 'https://api.example.com/v2', model: 'm' })
    expect(s.key()).toBe('old-key')

    s.save({ baseUrl: 'http://api.example.com/v2', model: 'm' })
    expect(s.key()).toBeNull()

    s.save({ baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'old-key' })
    s.save({ baseUrl: 'https://api.example.com:8443/v1', model: 'm' })
    expect(s.key()).toBeNull()

    s.save({ baseUrl: 'https://other.example/v1', model: 'm', apiKey: 'new-key' })
    expect(s.key()).toBe('new-key')
  })

  it('lỗi mã hoá key mới không đổi provider hoặc xoá key hiện có', () => {
    s.save({ baseUrl: 'https://a.example/v1', model: 'm', apiKey: 'old-key' })
    const broken = new AiSettingsStore(prefs, keys, { ...box, encrypt: () => { throw new Error('keychain failed') } })
    expect(() => broken.save({ baseUrl: 'https://b.example/v1', model: 'm', apiKey: 'new-key' })).toThrow('keychain failed')
    expect(s.get().baseUrl).toBe('https://a.example/v1')
    expect(s.key()).toBe('old-key')
  })

  it('đồng ý gắn với máy chủ: đổi baseUrl thì phải hỏi lại', () => {
    s.save({ baseUrl: 'https://a.example/v1', model: 'm' })
    s.grantConsent('p1')
    expect(s.hasConsent('p1')).toBe(true)
    expect(s.hasConsent('p2')).toBe(false)
    s.save({ baseUrl: 'https://b.example/v1', model: 'm' })
    expect(s.hasConsent('p1')).toBe(false)
  })

  it('từ chối URL không hợp lệ và máy không có kho khoá', () => {
    expect(() => s.save({ baseUrl: 'ftp://x', model: 'm' })).toThrow(expect.objectContaining({ code: 'bad_param' }))
    expect(() => new AiSettingsStore(prefs, keys, { ...box, available: () => false }).save({ baseUrl: 'https://a/v1', model: 'm', apiKey: 'k' }))
      .toThrow(expect.objectContaining({ code: 'no_keychain' }))
  })

  it('giữ các khoá khác trong prefs.json', () => {
    writeFileSync(prefs, JSON.stringify({ exportDir: '/x' }))
    s.save({ baseUrl: 'https://a/v1', model: 'm' })
    expect(JSON.parse(readFileSync(prefs, 'utf8')).exportDir).toBe('/x')
  })

  it('endpoint không sinh dấu // thừa', () => {
    expect(endpoint('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1/chat/completions')
    expect(endpoint('https://x/api/v1')).toBe('https://x/api/v1/chat/completions')
  })
})
