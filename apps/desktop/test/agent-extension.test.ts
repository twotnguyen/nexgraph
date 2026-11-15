import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createNexgraphExtension, previewWrite } from '../src/main/agent/extension'
import { NEXGRAPH_RULES, NEXGRAPH_SKILL_NAME, skillMarkdown } from '../src/main/agent/skill'
import { TOOL_DEFS } from '../src/main/ai/tools'
import type { EngineApi } from '../src/main/engine/api'
import type { ApprovalGate } from '../src/main/agent/approval'

type Handler = (e: { toolName: string; input: unknown }) => Promise<{ block: true; reason: string } | undefined>
const names = TOOL_DEFS.map((t) => t.function.name)

function setup(check: ApprovalGate['check'] = async () => ({ allow: true })) {
  const search = vi.fn(async () => ({ hits: [] }))
  const gate = { check: vi.fn(check) } as unknown as ApprovalGate
  const pi = { registerTool: vi.fn(), on: vi.fn() }
  createNexgraphExtension({ api: { search } as unknown as EngineApi, projectId: 'p1', gate })(pi as never)
  const handler = pi.on.mock.calls.find((c) => c[0] === 'tool_call')![1] as Handler
  return { pi, search, gate, handler }
}

describe('extension NexGraph', () => {
  it('đăng ký đúng 9 tool trùng TOOL_DEFS', () => {
    const { pi } = setup()
    expect(pi.registerTool.mock.calls.map((c) => c[0].name)).toEqual(names)
  })

  it('execute của search gọi runTool và trả content text', async () => {
    const { pi, search } = setup()
    const tool = pi.registerTool.mock.calls.map((c) => c[0]).find((t) => t.name === 'search')
    const r = await tool.execute('id1', { query: 'foo' }, undefined, undefined, {})
    expect(search).toHaveBeenCalledWith('p1', 'foo', { kinds: undefined, limit: undefined })
    expect(r).toEqual({ content: [{ type: 'text', text: '{"hits":[]}' }], details: {} })
  })

  it('tool_call: gate từ chối thì block, cho qua thì undefined, gate ném thì block', async () => {
    const deny = setup(async () => ({ allow: false, reason: 'không' }))
    expect(await deny.handler({ toolName: 'edit', input: { a: 1 } })).toEqual({ block: true, reason: 'không' })
    expect(deny.gate.check).toHaveBeenCalledWith('edit', { a: 1 })
    const ok = setup()
    expect(await ok.handler({ toolName: 'bash', input: {} })).toBeUndefined()
    const boom = setup(async () => { throw new Error('x') })
    expect(await boom.handler({ toolName: 'edit', input: {} })).toMatchObject({ block: true })
  })

  it('tool_call: chặn tên lạ, so khớp phân biệt hoa thường', async () => {
    const { handler, gate } = setup()
    for (const toolName of ['Bash', 'multiedit', 'get_node ', ...names, 'read', 'grep', 'find', 'ls']) {
      const blocked = toolName === 'Bash' || toolName === 'multiedit' || toolName === 'get_node '
      expect(await handler({ toolName, input: {} }) !== undefined).toBe(blocked)
    }
    expect(gate.check).toHaveBeenCalledTimes(names.length + 4)
  })
})

describe('previewWrite', () => {
  const root = join(mkdtempSync(join(tmpdir(), 'ng-ext-')), 'p')
  mkdirSync(root)
  writeFileSync(join(root, 'a.txt'), 'one two\nthree\n')

  it('write: before là nội dung hiện tại (rỗng nếu chưa có), after là nội dung mới', async () => {
    expect(await previewWrite(root, 'write', { path: 'a.txt', content: 'x' })).toEqual({ path: 'a.txt', before: 'one two\nthree\n', after: 'x' })
    expect(await previewWrite(root, 'write', { path: 'new.txt', content: 'y' })).toEqual({ path: 'new.txt', before: '', after: 'y' })
  })

  it('edit: áp dụng edits[] lên bản gốc; nhận đường dẫn tuyệt đối trong root', async () => {
    const r = await previewWrite(root, 'edit', { path: join(root, 'a.txt'), edits: [{ oldText: 'one', newText: '1' }, { oldText: 'three', newText: '3' }] })
    expect(r).toEqual({ path: 'a.txt', before: 'one two\nthree\n', after: '1 two\n3\n' })
  })

  it('ném khi edit không áp dụng được hoặc path ngoài root', async () => {
    const edit = (edits: unknown) => previewWrite(root, 'edit', { path: 'a.txt', edits })
    await expect(edit([{ oldText: 'zzz', newText: '' }])).rejects.toThrow()
    await expect(edit([{ oldText: '', newText: 'a' }])).rejects.toThrow()
    await expect(edit([{ oldText: 'o', newText: '0' }])).rejects.toThrow() // xuất hiện nhiều lần
    await expect(edit([{ oldText: 'one', newText: '1' }, { oldText: 'one two', newText: '' }])).rejects.toThrow() // chồng nhau
    await expect(edit([{ oldText: 'one', newText: 'one' }])).rejects.toThrow() // không đổi
    await expect(previewWrite(root, 'edit', { path: 'nope.txt', edits: [{ oldText: 'a', newText: 'b' }] })).rejects.toThrow()
    await expect(previewWrite(root, 'write', { path: '/etc/passwd', content: '' })).rejects.toThrow()
    await expect(previewWrite(root, 'write', { path: '../x', content: '' })).rejects.toThrow()
  })
})

describe('skill', () => {
  it('skillMarkdown có frontmatter, ba quy tắc và tên 9 tool', () => {
    const md = skillMarkdown()
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toMatch(new RegExp(`^---\\nname: ${NEXGRAPH_SKILL_NAME}\\ndescription: [^\\n]+\\n---\\n`))
    expect(NEXGRAPH_SKILL_NAME).toBe('nexgraph')
    expect(md).toContain(NEXGRAPH_RULES)
    for (const n of ['get_context', 'search', 'trace_flow', 'get_impact', 'đường_dẫn:dòng_đầu–dòng_cuối', ...names]) expect(md).toContain(n)
  })
})
