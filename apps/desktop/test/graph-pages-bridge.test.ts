// NG-UI-3: xác thực người gửi + payload của cầu nối chọn nút, làm giàu source_location từ engine.
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode } from '../src/shared/graph-types'
import { handlePageNodeMessage, lineFromLocation, validatePageNode } from '../src/main/graph-pages/bridge'
import { pageUrl } from '../src/main/graph-pages/protocol'

vi.mock('electron', () => ({ protocol: { registerSchemesAsPrivileged: vi.fn() } }))

const sender = (type = 'webview', url = pageUrl('pid-1', 'graph.html')) => ({
  getType: () => type, getURL: () => url, hostWebContents: { send: vi.fn() }
})
const node = (over: Partial<GraphNode> = {}): GraphNode => ({
  id: 'a.ts::run#function', kind: 'function' as GraphNode['kind'], label: 'run', qualified_name: 'run', language: 'typescript',
  file: 'src/a.ts', line_start: 12, line_end: 20, is_test: false, origin: 'ast', signature: null, community: null, ...over
})

describe('payload từ trang', () => {
  it('nhận đúng hình dạng, cắt chuỗi quá dài', () => {
    expect(validatePageNode({ id: 'n1', label: 'Nút', source_file: 'a.ts', source_location: 'a.ts:3', via: 'showInfo' }))
      .toEqual({ id: 'n1', label: 'Nút', source_file: 'a.ts', source_location: 'a.ts:3', via: 'showInfo' })
    expect(validatePageNode({ id: 'n1', label: 'x'.repeat(2001) })?.label).toBeNull()
    expect(validatePageNode({ label: 'no id' })).toBeNull()
    expect(validatePageNode('n1')).toBeNull()
    expect(validatePageNode({ id: 42 })).toBeNull()
  })
})

describe('cầu nối chọn nút', () => {
  it('tra source_location từ engine và bỏ qua người gửi không hợp lệ', async () => {
    const getNode = vi.fn(async () => node())
    const good = await handlePageNodeMessage({ sender: sender(), payload: { id: 'a.ts::run#function', label: 'run', via: 'showInfo' }, getNode })
    expect(good?.projectId).toBe('pid-1')
    expect(good?.selection).toMatchObject({ id: 'a.ts::run#function', label: 'run', sourceFile: 'src/a.ts', sourceLine: 12, sourceLocation: 'src/a.ts:12', via: 'showInfo' })
    expect(await handlePageNodeMessage({ sender: sender('window'), payload: { id: 'x' }, getNode })).toBeNull()
    expect(await handlePageNodeMessage({ sender: sender('webview', 'https://evil.example/x'), payload: { id: 'x' }, getNode })).toBeNull()
    expect(await handlePageNodeMessage({ sender: sender(), payload: null, getNode })).toBeNull()
  })

  it('engine lỗi (nút cộng đồng bị gộp) vẫn trả thông tin từ trang', async () => {
    const getNode = vi.fn(async () => { throw new Error('not found') })
    const result = await handlePageNodeMessage({ sender: sender(), payload: { id: '12', label: 'Graphify Host API', source_file: 'a.ts', source_location: 'a.ts:44' }, getNode })
    expect(result?.selection).toMatchObject({ id: '12', label: 'Graphify Host API', sourceFile: 'a.ts', sourceLine: 44 })
    expect(lineFromLocation('a.ts:44-51')).toBe(44)
    expect(lineFromLocation(null)).toBeNull()
  })
})
