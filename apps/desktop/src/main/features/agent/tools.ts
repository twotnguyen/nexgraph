import type { EngineApi } from '../../platform/engine/api'

export const MAX_TOOL_CHARS = 12_000

/** Kết quả tool là DỮ LIỆU, bọc trong delimiter để mô hình không nhầm với chỉ dẫn của người dùng. */
export const TOOL_RESULT_OPEN = '<nexgraph_tool_result>'
export const TOOL_RESULT_CLOSE = '</nexgraph_tool_result>'
const wrap = (name: string, body: string): string =>
  `${TOOL_RESULT_OPEN} tool="${name}"\n${body.split(TOOL_RESULT_CLOSE).join('[kết thúc kết quả tool đã thoát]')}\n${TOOL_RESULT_CLOSE}`

type Def = { type: 'function'; function: { name: string; description: string; parameters: object } }
const obj = (properties: Record<string, object>, required: string[] = []): object => ({ type: 'object', properties, required })
const str = { type: 'string' }
const int = { type: 'integer' }
const def = (name: string, description: string, parameters: object): Def => ({ type: 'function', function: { name, description, parameters } })

/** Đúng chín tool, tất cả chỉ đọc. Mô tả lấy theo SERVER_INSTRUCTIONS của MCP. */
export const TOOL_DEFS: Def[] = [
  def('get_context', 'Lấy các nút và đoạn mã liên quan nhất tới một câu hỏi, gọn trong ngân sách token.', obj({ question: str, budget: int }, ['question'])),
  def('search', 'Tìm ký hiệu hoặc tệp theo tên/từ khoá, xếp hạng giảm dần.', obj({ query: str, kinds: { type: 'array', items: str }, limit: int }, ['query'])),
  def('get_node', 'Lấy một nút theo id (ví dụ `lib/a.dart::A.run#method`).', obj({ node_id: str }, ['node_id'])),
  def('get_neighbors', 'Láng giềng của một nút: direction=in cho ai gọi/import X, out cho X gọi/dùng gì.',
    obj({ node_id: str, types: { type: 'array', items: str }, direction: { type: 'string', enum: ['in', 'out', 'both'] }, depth: int, limit: int }, ['node_id'])),
  def('read_code', 'Đọc mã của tệp đã lập chỉ mục (đường dẫn tương đối), tối đa 2.000 dòng.', obj({ file: str, start: int, end: int }, ['file'])),
  def('list_flows', 'Liệt kê các luồng thực thi từ điểm vào (route, lệnh, main); dùng để biết một tính năng chạy qua đâu.', obj({ query: str, kind: str, limit: int })),
  def('trace_flow', 'Các bước của một luồng, mỗi bước kèm hàm gọi và dòng gọi.', obj({ flow_id: int }, ['flow_id'])),
  def('get_architecture', 'Các khối kiến trúc (tối đa 12) và mũi tên giữa chúng; parent là id khối để đi sâu.', obj({ parent: str })),
  def('get_impact', 'Vùng ảnh hưởng và test liên quan nếu sửa một nút.', obj({ node_id: str }, ['node_id']))
]

type Args = Record<string, unknown>
const s = (v: unknown): string => String(v)
const n = (v: unknown): number | undefined => (v == null ? undefined : Number(v))

const run = (api: EngineApi, pid: string, name: string, a: Args): Promise<unknown> | null => {
  switch (name) {
    case 'get_context': return api.context(pid, s(a.question), n(a.budget))
    case 'search': return api.search(pid, s(a.query), { kinds: a.kinds as string[] | undefined, limit: n(a.limit) })
    case 'get_node': return api.getNode(pid, s(a.node_id))
    case 'get_neighbors': {
      const { node_id: node, ...rest } = a
      return api.neighbors(pid, { node: s(node), ...(rest as object) })
    }
    case 'read_code': return api.code(pid, s(a.file), n(a.start), n(a.end))
    case 'list_flows': return api.flows(pid, { q: a.query as string | undefined, kind: a.kind as never, limit: n(a.limit) })
    case 'trace_flow': return api.flow(pid, Number(a.flow_id))
    case 'get_architecture': return api.architecture(pid, a.parent as string | undefined)
    case 'get_impact': return api.impactOf(pid, s(a.node_id))
    default: return null
  }
}

/** Luôn trả chuỗi, không ném: lỗi trả về cho mô hình để nó tự sửa. */
export async function runTool(api: EngineApi, projectId: string, name: string, argsJson: string): Promise<string> {
  let args: Args
  try {
    const v: unknown = JSON.parse(argsJson || '{}')
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object')
    args = v as Args
  } catch {
    return wrap(name, JSON.stringify({ error: 'bad_arguments' }))
  }
  if (!TOOL_DEFS.some((t) => t.function.name === name)) return wrap(name, JSON.stringify({ error: 'unknown_tool' }))
  try {
    const out = JSON.stringify(await run(api.forModel(), projectId, name, args))
    const body = out.length > MAX_TOOL_CHARS ? `${out.slice(0, MAX_TOOL_CHARS)}\n…[đã cắt, hãy thu hẹp truy vấn]` : out
    return wrap(name, body)
  } catch (err) {
    const e = err as { code?: string; message?: string }
    return wrap(name, JSON.stringify({ error: e.code ?? 'tool_failed', message: e.message ?? String(err) }))
  }
}
