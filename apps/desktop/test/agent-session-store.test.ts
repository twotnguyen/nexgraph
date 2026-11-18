import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPi } from '../src/main/agent/session'
import { SessionStore, type SessionScope } from '../src/main/agent/session-store'

const roots: string[] = []
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'ng-durable-'))
  roots.push(base)
  const project = join(base, 'Đồ án')
  mkdirSync(project)
  const scope: SessionScope = {
    projectId: 'p1', root: realpathSync.native(project), provider: 'provider-a', baseUrl: 'https://ai.example/v1', account: 'account-a'
  }
  const dataDir = join(base, 'data')
  return { base, dataDir, scope, store: new SessionStore(dataDir, loadPi) }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('persistent Pi session store', () => {
  it('reopens the official JSONL conversation by ID and preserves an empty new conversation', async () => {
    const { store, dataDir, scope } = setup()
    const first = await store.open(scope, 'model-a')
    first.manager.appendMessage({ role: 'user', content: 'Explain login', timestamp: Date.now() })
    store.touch(first, 'model-a', 'Explain login')
    const id = first.record.id
    const reopened = await new SessionStore(dataDir, loadPi).open(scope, 'model-b')
    expect(reopened.record.id).toBe(id)
    expect(reopened.manager.buildSessionContext().messages).toMatchObject([{ role: 'user', content: 'Explain login' }])
    const blank = await store.open(scope, 'model-a', undefined, true)
    expect(blank.record.id).not.toBe(id)
    expect(existsSync(blank.manager.getSessionFile()!)).toBe(false)
    const restoredBlank = await new SessionStore(dataDir, loadPi).open(scope, 'model-a')
    expect(restoredBlank.record.id).toBe(blank.record.id)
    expect(restoredBlank.manager.buildSessionContext().messages).toEqual([])
  })

  it.each(['projectId', 'root', 'provider', 'baseUrl', 'account'] as const)('isolates a session when %s changes', async (field) => {
    const { store, scope, base } = setup()
    const original = await store.open(scope, 'model-a')
    original.manager.appendMessage({ role: 'user', content: 'private project history', timestamp: Date.now() })
    store.touch(original, 'model-a')
    const otherRoot = join(base, 'other')
    mkdirSync(otherRoot)
    const other = { ...scope, [field]: field === 'root' ? realpathSync.native(otherRoot) : scope[field] + '-other' }
    expect(store.list(other)).toEqual([])
    await expect(store.open(other, 'model-a', original.record.id)).rejects.toMatchObject({ code: 'session_not_found' })
  })

  it('marks a persisted running task cancelled after an application restart, including its manifest', async () => {
    const { store, dataDir, scope } = setup()
    const session = await store.open(scope, 'model-a')
    session.manager.appendMessage({ role: 'user', content: 'work', timestamp: Date.now() })
    const task = {
      id: randomUUID(), sessionId: session.record.id, status: 'running' as const, startedAt: Date.now(), turns: 2,
      limits: { maxTurns: 10, maxDurationMs: 10000, maxTokens: 5000 }
    }
    store.task(session, task)
    const restored = await new SessionStore(dataDir, loadPi).open(scope, 'model-a')
    expect(restored.record.task).toMatchObject({ id: task.id, status: 'cancelled', finishedAt: expect.any(Number) })
    expect(JSON.parse(readFileSync(join(session.directory, 'tasks', task.id + '.json'), 'utf8')).status).toBe('cancelled')
  })

  it('rejects a transcript whose header belongs to another root and leaves the original bytes intact', async () => {
    const { store, scope } = setup()
    const session = await store.open(scope, 'model-a')
    session.manager.appendMessage({ role: 'user', content: 'private', timestamp: Date.now() })
    store.touch(session, 'model-a')
    const file = session.manager.getSessionFile()!
    const original = readFileSync(file, 'utf8')
    const lines = original.split('\n')
    const header = JSON.parse(lines[0])
    lines[0] = JSON.stringify({ ...header, cwd: 'another project' })
    const tampered = lines.join('\n')
    writeFileSync(file, tampered)
    await expect(store.open(scope, 'model-a')).rejects.toMatchObject({ code: 'session_corrupt' })
    expect(readFileSync(file, 'utf8')).toBe(tampered)
  })

  it('refuses a malformed index rather than silently replacing conversation metadata', async () => {
    const { store, scope } = setup()
    await store.open(scope, 'model-a')
    const file = join(store.directory(scope), 'index.json')
    writeFileSync(file, '{broken')
    expect(() => store.list(scope)).toThrow(expect.objectContaining({ code: 'session_corrupt' }))
    await expect(store.open(scope, 'model-a')).rejects.toMatchObject({ code: 'session_corrupt' })
    expect(readFileSync(file, 'utf8')).toBe('{broken')
  })

  it('does not recreate a missing populated transcript and deletes the canonical file when requested', async () => {
    const { store, scope } = setup()
    const session = await store.open(scope, 'model-a')
    session.manager.appendMessage({ role: 'user', content: 'private', timestamp: Date.now() })
    store.touch(session, 'model-a')
    const file = session.manager.getSessionFile()!
    const bytes = readFileSync(file)
    rmSync(file)
    await expect(store.open(scope, 'model-a')).rejects.toMatchObject({ code: 'session_missing' })
    writeFileSync(file, bytes)
    store.remove(scope, session.record.id)
    expect(existsSync(file)).toBe(false)
    expect(store.list(scope)).toEqual([])
    await expect(store.open(scope, 'model-a', '../foreign')).rejects.toMatchObject({ code: 'bad_param' })
  })
})
