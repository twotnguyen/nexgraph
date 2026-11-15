import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createNexgraphExtension, previewWrite } from '../src/main/agent/extension'
import { NEXGRAPH_RULES, NEXGRAPH_SKILL_NAME, skillMarkdown } from '../src/main/agent/skill'
import { TOOL_DEFS } from '../src/main/ai/tools'
import type { EngineApi } from '../src/main/engine/api'
import type { ApprovalGate } from '../src/main/agent/approval'

type Handler = (e: { toolName: string; input: any }) => Promise<{ block: true; reason: string } | undefined>
const names = TOOL_DEFS.map((t) => t.function.name)

const base = realpathSync(mkdtempSync(join(tmpdir(), 'ng-ext-h-')))
const proj = join(base, 'p')
mkdirSync(proj)
writeFileSync(join(proj, 'a.txt'), 'x')

function setup(check: ApprovalGate['check'] = async () => ({ allow: true })) {
  const search = vi.fn(async () => ({ hits: [] }))
  const gate = { check: vi.fn(check) } as unknown as ApprovalGate
  const pi = { registerTool: vi.fn(), on: vi.fn() }
  createNexgraphExtension({ api: { search } as unknown as EngineApi, projectId: 'p1', root: proj, gate })(pi as never)
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
    expect(await deny.handler({ toolName: 'edit', input: { path: 'a.txt' } })).toEqual({ block: true, reason: 'không' })
    expect(deny.gate.check).toHaveBeenCalledWith('edit', { path: join(proj, 'a.txt') })
    const empty = setup((async () => ({ allow: false })) as never)
    expect(await empty.handler({ toolName: 'bash', input: {} })).toMatchObject({ block: true, reason: expect.stringMatching(/\S/) })
    const ok = setup()
    expect(await ok.handler({ toolName: 'bash', input: {} })).toBeUndefined()
    const boom = setup(async () => { throw new Error('x') })
    expect(await boom.handler({ toolName: 'edit', input: { path: 'a.txt' } })).toMatchObject({ block: true })
  })

  it('tool_call: chặn tên lạ, so khớp phân biệt hoa thường', async () => {
    const { handler, gate } = setup()
    for (const toolName of ['Bash', 'multiedit', 'get_node ', ...names, 'read', 'grep', 'find', 'ls']) {
      const blocked = toolName === 'Bash' || toolName === 'multiedit' || toolName === 'get_node '
      expect(await handler({ toolName, input: { path: 'a.txt' } }) !== undefined).toBe(blocked)
    }
    expect(gate.check).toHaveBeenCalledTimes(names.length + 4)
  })
})

describe('tool_call: chuẩn hoá đường dẫn của pi', () => {
  const bad = ['@/etc/x', '~/x', '~', 'file:///etc/x', 'FILE:///etc/x', 'a\u00a0b', 'a\u2003b', 'a\u202fb', 'a\u3000b']
  for (const toolName of ['write', 'read', 'edit', 'ls', 'grep', 'find']) {
    it(`${toolName}: chặn không hỏi khi path bị pi viết lại`, async () => {
      const { handler, gate } = setup()
      for (const path of bad) expect(await handler({ toolName, input: { path } })).toMatchObject({ block: true })
      expect(gate.check).not.toHaveBeenCalled()
    })
  }

  it('chặn path ngoài root, cho qua path vắng của ls/grep/find', async () => {
    const { handler, gate } = setup()
    expect(await handler({ toolName: 'read', input: { path: '../x' } })).toMatchObject({ block: true })
    expect(await handler({ toolName: 'read', input: { path: '/etc/passwd' } })).toMatchObject({ block: true })
    expect(await handler({ toolName: 'read', input: { path: 5 } })).toMatchObject({ block: true })
    expect(await handler({ toolName: 'read', input: {} })).toMatchObject({ block: true })
    expect(gate.check).not.toHaveBeenCalled()
    for (const toolName of ['ls', 'grep', 'find']) expect(await handler({ toolName, input: {} })).toBeUndefined()
  })

  it('ghim path tuyệt đối đã kiểm vào event.input, gate nhận đúng path đó', async () => {
    const { handler, gate } = setup()
    const input = { path: 'sub/../new.txt', content: 'y' }
    expect(await handler({ toolName: 'write', input })).toBeUndefined()
    expect(input.path).toBe(join(proj, 'new.txt'))
    expect(gate.check).toHaveBeenCalledWith('write', input)
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

  it('edit: CRLF trong oldText/newText được chuẩn hoá như pi, before/after là văn bản LF', async () => {
    writeFileSync(join(root, 'crlf.txt'), 'a\r\nb\r\nc\rd\r\n')
    const r = await previewWrite(root, 'edit', { path: 'crlf.txt', edits: [{ oldText: 'a\r\nb', newText: 'x\r\ny\rz' }, { oldText: 'c\rd', newText: 'c2' }] })
    expect(r.after).toBe('x\ny\nz\nc2\n')
    expect(r.after).not.toContain('\r')
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
