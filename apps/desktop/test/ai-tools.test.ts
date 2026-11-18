import { describe, expect, it, vi } from 'vitest'
import { EngineApiError, type EngineApi } from '../src/main/engine/api'
import { MAX_TOOL_CHARS, TOOL_DEFS, TOOL_RESULT_CLOSE, TOOL_RESULT_OPEN, runTool } from '../src/main/ai/tools'

/** Bỏ delimiter framing để kiểm nội dung JSON bên trong. */
const payload = (s: string): string => {
  expect(s.startsWith(TOOL_RESULT_OPEN)).toBe(true)
  expect(s.endsWith(TOOL_RESULT_CLOSE)).toBe(true)
  return s.slice(s.indexOf('\n') + 1, s.lastIndexOf('\n'))
}

const api = () => ({ code: vi.fn(async () => ({})), neighbors: vi.fn(async () => ({})), search: vi.fn(), getNode: vi.fn(), flow: vi.fn(),
  flows: vi.fn(), context: vi.fn(), architecture: vi.fn(), impactOf: vi.fn() })
const as = (a: ReturnType<typeof api>): EngineApi => ({ forModel: () => a }) as unknown as EngineApi

describe('AI tools', () => {
  it('chín tool, không tool nào có tên gợi ý ghi', () => {
    expect(TOOL_DEFS.map((t) => t.function.name)).toEqual(['get_context', 'search', 'get_node', 'get_neighbors', 'read_code', 'list_flows', 'trace_flow', 'get_architecture', 'get_impact'])
    expect(TOOL_DEFS.every((t) => !/write|edit|delete|run|exec|shell/i.test(t.function.name))).toBe(true)
  })

  it('runTool ánh xạ tham số sang EngineApi', async () => {
    const a = api()
    await runTool(as(a), 'p1', 'read_code', '{"file":"a.ts","start":3,"end":9}')
    expect(a.code).toHaveBeenCalledWith('p1', 'a.ts', 3, 9)
    await runTool(as(a), 'p1', 'get_neighbors', '{"node_id":"a#file","direction":"in"}')
    expect(a.neighbors).toHaveBeenCalledWith('p1', { node: 'a#file', direction: 'in' })
  })

  it('không bao giờ ném: tool lạ, JSON hỏng, lỗi engine', async () => {
    const a = api()
    expect(JSON.parse(payload(await runTool(as(a), 'p1', 'write_file', '{}')))).toEqual({ error: 'unknown_tool' })
    expect(JSON.parse(payload(await runTool(as(a), 'p1', 'search', '{oops')))).toEqual({ error: 'bad_arguments' })
    a.getNode.mockRejectedValue(new EngineApiError(404, 'unknown_node', 'Không có nút x'))
    expect(JSON.parse(payload(await runTool(as(a), 'p1', 'get_node', '{"node_id":"x"}')))).toEqual({ error: 'unknown_node', message: 'Không có nút x' })
  })

  it('bọc kết quả tool trong delimiter rõ ràng (dữ liệu, không phải chỉ dẫn)', async () => {
    const a = api()
    const out = await runTool(as(a), 'p1', 'search', '{"query":"x"}')
    expect(out.startsWith(TOOL_RESULT_OPEN)).toBe(true)
    expect(out).toContain('tool="search"')
    expect(out.endsWith(TOOL_RESULT_CLOSE)).toBe(true)
  })

  it('cắt kết quả dài', async () => {
    const a = api()
    a.code.mockResolvedValue({ file: 'a', start: 1, end: 9, text: 'x'.repeat(50_000), language: null, stale: false } as never)
    const out = await runTool(as(a), 'p1', 'read_code', '{"file":"a"}')
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CHARS + 120) // cộng delimiter framing
    expect(out).toContain('[đã cắt')
  })
})
