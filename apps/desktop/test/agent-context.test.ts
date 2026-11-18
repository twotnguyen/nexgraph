import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { prepareAgentContext } from '../src/main/agent/context'
import { readProjectFile } from '../src/main/fs/project-fs'
import type { EngineApi } from '../src/main/engine/api'
import { externalWebUrl, isSameDocument } from '../src/main/external-links'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ng-context-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.ts'), 'first\nsecond\nthird\n')
  writeFileSync(join(root, '.env'), 'FAKE_PRIVATE_TOKEN')
  const api = {
    forModel: vi.fn<() => EngineApi>(),
    stats: vi.fn(async () => ({ indexed_at: '2026-11-19', index_commit: 'old', head_commit: 'new', stale: true })),
    aiSourceExcludes: vi.fn(async () => [] as string[]),
    getNode: vi.fn(async (_pid: string, id: string) => ({ id, label: 'login', file: 'src/a.ts' })),
    neighbors: vi.fn(async () => ({ nodes: [], edges: [], truncated: false })),
    flow: vi.fn(async () => ({ id: 5, steps: [{ file: 'src/a.ts', line: 2 }] })),
    architecture: vi.fn(async () => ({ parent: 'src', blocks: [], links: [] }))
  }
  api.forModel.mockReturnValue(api as unknown as EngineApi)
  return { root, api, deps: { root, api: api as unknown as EngineApi, projectId: 'p1' } }
}

const json = (prompt: string) => JSON.parse(prompt.slice(prompt.indexOf('\n') + 1))

describe('explicit AI context', () => {
  it('preserves selected unsaved text, source version and graph provenance', async () => {
    const f = setup()
    const disk = await readProjectFile(f.root, 'src/a.ts')
    const result = await prepareAgentContext({ ...f.deps, items: [
      { kind: 'file', file: 'src/a.ts', start: 2, end: 2, text: 'draft selected text', version: disk.version, dirty: true }
    ] })
    expect(json(result.prompt)).toMatchObject({
      graph: { indexedAt: '2026-11-19', indexCommit: 'old', headCommit: 'new', stale: true },
      attachments: [{ kind: 'file', reference: 'src/a.ts:2-2', data: {
        source: 'unsaved_editor_snapshot', text: 'draft selected text', version: disk.version, start: 2, end: 2
      } }]
    })
    expect(result.items[0]).toMatchObject({ dirty: true, text: 'draft selected text' })
    expect(result.characters).toBe(result.prompt.length)
  })

  it('rejects traversal, protected paths, stale versions and malformed selection metadata', async () => {
    const f = setup()
    for (const file of ['../outside.ts', '.env', '.git/config']) {
      await expect(prepareAgentContext({ ...f.deps, items: [{ kind: 'file', file }] }))
        .rejects.toMatchObject({ code: file.startsWith('..') ? 'outside_project' : 'protected_path' })
    }
    await expect(prepareAgentContext({ ...f.deps, items: [{ kind: 'file', file: 'src/a.ts', version: 'old-version' }] }))
      .rejects.toMatchObject({ code: 'conflict' })
    for (const over of [{ start: 0 }, { start: 3, end: 2 }, { end: 999 }, { dirty: true }]) {
      await expect(prepareAgentContext({ ...f.deps, items: [{ kind: 'file', file: 'src/a.ts', ...over }] }))
        .rejects.toMatchObject({ code: 'bad_param' })
    }
    await expect(prepareAgentContext({ ...f.deps, items: [{ kind: 'node', nodeId: 'x'.repeat(2001) }] }))
      .rejects.toMatchObject({ code: 'bad_param' })
    await expect(prepareAgentContext({ ...f.deps, items: Array.from({ length: 13 }, () => ({ kind: 'file' as const, file: 'src/a.ts' })) }))
      .rejects.toMatchObject({ code: 'bad_param' })
  })

  it('bounds the actual serialized wrapper including escaped source and truncates stored attachment snapshots', async () => {
    const f = setup()
    const result = await prepareAgentContext({ ...f.deps, items: [
      { kind: 'file', file: 'src/a.ts', text: '"\\\n'.repeat(25000), dirty: true },
      { kind: 'node', nodeId: 'not-sent' }
    ] })
    expect(result.prompt.length).toBeLessThanOrEqual(32000)
    expect(result.truncated).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].kind === 'file' && result.items[0].text!.length).toBeLessThan(32000)
    const data = json(result.prompt).attachments[0].data
    expect(data).toMatchObject({ source: 'unsaved_editor_snapshot', file: 'src/a.ts', truncated: true })
    expect(f.api.getNode).not.toHaveBeenCalled()
  })

  it('requests node, flow and architecture data only from the selected project', async () => {
    const f = setup()
    const result = await prepareAgentContext({ ...f.deps, items: [
      { kind: 'node', nodeId: 'src/a.ts::login#function' },
      { kind: 'flow', flowId: 5 },
      { kind: 'architecture', blockId: 'src' }
    ] })
    expect(f.api.getNode).toHaveBeenCalledWith('p1', 'src/a.ts::login#function')
    expect(f.api.neighbors).toHaveBeenCalledWith('p1', expect.objectContaining({ node: 'src/a.ts::login#function', depth: 1, limit: 40 }))
    expect(f.api.flow).toHaveBeenCalledWith('p1', 5)
    expect(f.api.architecture).toHaveBeenCalledWith('p1', 'src')
    expect(f.api.stats).toHaveBeenCalledWith('p1')
    expect(json(result.prompt).attachments.map((item: { kind: string }) => item.kind)).toEqual(['node', 'flow', 'architecture'])
  })

  it('blocks explicitly excluded drafts and maps root architecture to the real API root', async () => {
    const f = setup()
    f.api.aiSourceExcludes.mockResolvedValue(['src/**'])
    await expect(prepareAgentContext({ ...f.deps, items: [
      { kind: 'file', file: 'src/a.ts', text: 'draft excluded', dirty: true }
    ] })).rejects.toThrow('phạm vi truy cập của AI')
    await prepareAgentContext({ ...f.deps, items: [{ kind: 'architecture', blockId: 'root' }] })
    expect(f.api.architecture).toHaveBeenCalledWith('p1', undefined)
  })
})

describe('renderer external links', () => {
  it('opens explicit web URLs and rejects executable protocols and embedded credentials', () => {
    expect(externalWebUrl('https://example.com/docs?q=hello#auth')).toBe('https://example.com/docs?q=hello#auth')
    for (const url of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,test', 'https://user:pass@example.com', 'not a url']) {
      expect(externalWebUrl(url)).toBeNull()
    }
    expect(isSameDocument('file:///C:/app/index.html', 'file:///C:/app/index.html#settings')).toBe(true)
    expect(isSameDocument('file:///C:/app/index.html', 'file:///C:/secret')).toBe(false)
    expect(isSameDocument('http://localhost:5173/', 'https://example.com/')).toBe(false)
  })
})
