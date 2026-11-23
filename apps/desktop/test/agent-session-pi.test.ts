// Kiểm AgentService với SDK pi THẬT (nạp ESM, typebox, hook tool_call) và một máy chủ giả tương thích OpenAI (SSE).
import http from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { toolsFor } from '../src/main/agent/extension'
import { AgentService, createPiSession } from '../src/main/agent/session'
import { AccountService } from '../src/main/agent/accounts'
import { SecretStore } from '../src/main/ai/settings'
import type { EngineApi } from '../src/main/engine/api'
import type { AgentEvent, AiConsentTarget } from '../src/shared/agent-types'

const KEY = 'sk-test-khong-duoc-ghi-ra-dia'
const OUTSIDE = `/tmp/x-outside-${process.pid}-${Date.now()}`
const OUTSIDE_READ = join(realpathSync.native(tmpdir()), `ng-outside-read-${process.pid}-${Date.now()}.txt`)
const MARK = {
  root: 'MARKER-AGENTS-GOC-7f3a', parent: 'MARKER-AGENTS-CHA-91c2', outside: 'MARKER-NGOAI-DU-AN-55e0',
  system: 'MARKER-SYSTEM-DU-AN-8173', append: 'MARKER-APPEND-DU-AN-7220', template: 'MARKER-TEMPLATE-DU-AN-3441'
}
const SHELL_ALIASES = ['bash', 'Bash', 'powershell', 'terminal', 'shell', 'run_command', 'codemode']

function createFileLink(target: string, path: string): boolean {
  try {
    symlinkSync(target, path)
    return true
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return false
    throw error
  }
}
const SHELL_OUTPUT = 'shell-would-write.txt'

type Msg = { role: string; content?: unknown }
/** Kịch bản theo câu hỏi cuối: lượt đầu gọi tool, sau khi có kết quả tool thì trả lời. */
const SCRIPT: Record<string, [string, object]> = {
  'tra đồ thị': ['search', { query: 'login' }],
  'viết b.txt': ['write', { path: 'b.txt', content: 'nội dung mới' }],
  'viết c.txt': ['write', { path: 'c.txt', content: 'không được ghi' }],
  'viết ngoài': ['write', { path: `@${OUTSIDE}`, content: 'x' }],
  'viết d.txt': ['write', { path: 'd.txt', content: 'bị dừng' }],
  'ghi e.txt': ['write', { path: 'e.txt', content: 'độc hại' }],
  'sửa f.txt': ['edit', { path: 'f.txt', edits: [{ oldText: 'gốc', newText: 'bản AI' }] }],
  'sửa h.txt': ['edit', { path: 'h.txt', edits: [{ oldText: 'bản gốc', newText: 'bản đã duyệt' }] }],
  'đọc marker.txt': ['read', { path: 'marker.txt' }],
  'viết g.txt': ['write', { path: 'g.txt', content: 'không được ghi' }],
  'checkpoint lưu bền': ['write', { path: 'checkpoint.py', content: 'saved = True\n' }],
  'đọc ngoài': ['read', { path: OUTSIDE_READ }],
  'đọc nháy': ['read', { path: "a'b.txt" }],
  'thử ghi khi đang hỏi': ['write', { path: 'ask-would-write.txt', content: 'không được ghi' }]
}
for (const name of SHELL_ALIASES) SCRIPT[`tool giả lập ${name}!`] = [name, { command: `echo sentinel > ${SHELL_OUTPUT}` }]

function fakeLlm(seen: { auth: string[]; tools: string[][]; bodies: string[] }, redirectTo?: string): Promise<{ url: string; close: () => Promise<void> }> {
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.auth.push(String(req.headers.authorization))
      seen.bodies.push(body)
      if (redirectTo) {
        res.writeHead(307, { location: redirectTo })
        return res.end()
      }
      const j = JSON.parse(body || '{}') as { messages?: Msg[]; tools?: { function: { name: string } }[] }
      seen.tools.push((j.tools ?? []).map((t) => t.function.name))
      const msgs = j.messages ?? []
      const lastUser = msgs.map((m) => m.role).lastIndexOf('user')
      const q = JSON.stringify(msgs[lastUser]?.content ?? '')
      const answered = msgs.slice(lastUser).some((m) => m.role === 'tool')
      if (q.includes('khoá sai')) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"bad key"}}') }
      const step = Object.entries(SCRIPT).find(([k]) => q.includes(k))?.[1]
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (c: object) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'fake-1', ...c })}\n\n`)
      if (step && !answered) {
        send({ choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] }, finish_reason: null }] })
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        send({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Xong ' }, finish_reason: null }] })
        send({ choices: [{ index: 0, delta: { content: '[[a.py:1-1]]' }, finish_reason: null }] })
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } })
      }
      res.end('data: [DONE]\n\n')
    })
  })
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({
    url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`,
    close: () => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()) })
  })))
}

const filesUnder = (dir: string): string[] => !existsSync(dir) ? [] : readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? filesUnder(p) : [p]
})

describe('AgentService + pi SDK thật', () => {
  const seen = { auth: [] as string[], tools: [] as string[][], bodies: [] as string[] }
  const events: AgentEvent[] = []
  const searches: unknown[] = []
  let llm: Awaited<ReturnType<typeof fakeLlm>>
  let accounts: AccountService
  let target: AiConsentTarget
  let svc: AgentService
  let root: string
  let dataDir: string

  beforeAll(async () => {
    process.env.NEXGRAPH_ALLOW_HTTP_PROVIDER = '1' // LLM giả chạy trên 127.0.0.1
    llm = await fakeLlm(seen)
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'ng-pi-real-')))
    root = join(base, 'proj')
    dataDir = join(base, 'data')
    mkdirSync(root)
    mkdirSync(dataDir)
    writeFileSync(join(root, 'a.py'), 'print(1)\n')
    writeFileSync(join(root, 'AGENTS.md'), `# Quy ước\n${MARK.root}\n`)
    writeFileSync(join(base, 'AGENTS.md'), `# Ngoài dự án\n${MARK.parent}\n`)
    mkdirSync(join(root, '.pi', 'prompts'), { recursive: true })
    writeFileSync(join(root, '.pi', 'SYSTEM.md'), MARK.system)
    writeFileSync(join(root, '.pi', 'APPEND_SYSTEM.md'), MARK.append)
    writeFileSync(join(root, '.pi', 'prompts', 'nexgraph-run.md'), MARK.template)
    writeFileSync(OUTSIDE_READ, MARK.outside)
    accounts = await AccountService.create({
      dataDir, prefsFile: join(base, 'prefs.json'),
      secrets: new SecretStore(join(base, 'key.json'), { available: () => true, encrypt: (s) => `enc:${s}`, decrypt: (s) => s.slice(4) }),
      openExternal: () => {}, notify: () => {}, modelsChanged: () => {}, ask: async () => null
    })
    await accounts.saveCustomProvider({ id: 'fake', label: 'Fake', baseUrl: llm.url, model: 'fake-1' }, KEY)
    accounts.selectModel('fake', 'fake-1')
    target = (await accounts.getConsentTarget())!
    await accounts.grantConsent('p1', target)
    const api = {
      forModel() { return this },
      aiSourceExcludes: async () => [],
      search: async (...a: unknown[]) => { searches.push(a); return [] },
      code: async (_p: string, file: string, start: number, end: number) => ({ file, start, end, text: 'print(1)' })
    } as unknown as EngineApi
    svc = new AgentService({
      api, dataDir, accounts: async () => accounts,
      rootOf: async () => root, emit: (_pid, e) => events.push(e)
    })
  }, 30_000)

  afterAll(async () => {
    svc?.closeAll()
    await llm?.close()
    delete process.env.NEXGRAPH_ALLOW_HTTP_PROVIDER
    rmSync(OUTSIDE_READ, { force: true })
  })

  const lastEnd = () => events.filter((e) => e.type === 'done' || e.type === 'error').at(-1)
  /** Chạy một lượt; khi có yêu cầu duyệt thì trả lời bằng `answer`. */
  async function turn(text: string, answer?: boolean, beforeApproval?: () => void) {
    const from = events.length
    const run = svc.prompt('p1', text, target)
    if (answer !== undefined) {
      const t0 = Date.now()
      while (!events.slice(from).some((e) => e.type === 'approval')) {
        if (Date.now() - t0 > 10_000) throw new Error('không thấy sự kiện approval')
        await new Promise((r) => setTimeout(r, 10))
      }
      const req = events.slice(from).find((e) => e.type === 'approval') as Extract<AgentEvent, { type: 'approval' }>
      beforeApproval?.()
      svc.approve('p1', req.request.id, answer)
    }
    await run
    return events.slice(from)
  }

  it('(a) chế độ Hỏi: mô hình gọi tool đồ thị, lượt kết thúc bằng done có trích dẫn đã kiểm', async () => {
    const evs = await turn('tra đồ thị')
    expect(searches).toHaveLength(1)
    expect(evs).toContainEqual({ type: 'tool', name: 'search', status: 'start' })
    expect(lastEnd()).toEqual({ type: 'done', text: 'Xong [[a.py:1-1]]', citations: [expect.objectContaining({ file: 'a.py', valid: true })] })
    expect(seen.tools[0].sort()).toEqual(['find', 'get_architecture', 'get_context', 'get_impact', 'get_neighbors', 'get_node', 'grep', 'list_flows', 'ls', 'read', 'read_code', 'search', 'trace_flow'])
    expect(seen.auth[0]).toBe(`Bearer ${KEY}`)
  }, 30_000)

  it('Pi thiếu extension NexGraph thì không dùng công cụ dựng sẵn thay thế', async () => {
    const model = accounts.modelRuntime.getModel('fake', 'fake-1')!
    await expect(createPiSession({
      cwd: root, agentDir: join(dataDir, 'agent'), tools: toolsFor('edit'),
      modelRuntime: accounts.modelRuntime, model, extension: () => {},
      assertDispatch: () => {}, assertRequest: () => {}
    })).rejects.toMatchObject({ code: 'ai_error', message: 'Không nạp được bộ công cụ an toàn của NexGraph' })
  }, 30_000)

  it('tool chạy lệnh không khai báo, không xin duyệt và không ghi tệp trong Hỏi hoặc Sửa', async () => {
    for (const mode of ['ask', 'edit'] as const) {
      svc.setMode('p1', mode)
      for (const name of SHELL_ALIASES) {
        const evs = await turn(`tool giả lập ${name}!`)
        expect(evs).toContainEqual({ type: 'tool', name, status: 'end', error: true })
        expect(evs.some((event) => event.type === 'approval')).toBe(false)
        expect(seen.tools.at(-1)?.slice().sort()).toEqual(toolsFor(mode).sort())
      }
      expect(existsSync(join(root, SHELL_OUTPUT))).toBe(false)
    }
    svc.setMode('p1', 'ask')
    const evs = await turn('thử ghi khi đang hỏi')
    expect(evs).toContainEqual({ type: 'tool', name: 'write', status: 'end', error: true })
    expect(evs.some((event) => event.type === 'approval')).toBe(false)
    expect(existsSync(join(root, 'ask-would-write.txt'))).toBe(false)
  }, 30_000)

  it('gửi nguyên văn dấu ! và câu hỏi có dấu / ở cả hai chế độ', async () => {
    for (const mode of ['ask', 'edit'] as const) {
      svc.setMode('p1', mode)
      for (const prompt of [`!echo sentinel > ${SHELL_OUTPUT}`, '/nexgraph-run', '/skill:nexgraph']) {
        const evs = await turn(prompt)
        expect(evs.some((event) => event.type === 'approval' || event.type === 'tool')).toBe(false)
        const body = JSON.parse(seen.bodies.at(-1)!) as { messages: Msg[] }
        const lastUser = body.messages.findLast((message) => message.role === 'user')
        expect(JSON.stringify(lastUser?.content)).toContain(prompt)
      }
      expect(existsSync(join(root, SHELL_OUTPUT))).toBe(false)
    }
  }, 30_000)

  it('(b) chế độ Sửa: write trong dự án → approval → duyệt → tệp có trên đĩa', async () => {
    svc.setMode('p1', 'edit')
    const evs = await turn('viết b.txt', true)
    expect(evs.find((e) => e.type === 'approval')).toMatchObject({ request: { tool: 'write', path: 'b.txt', before: '', after: 'nội dung mới' } })
    expect(evs.some((e) => e.type === 'approval_closed')).toBe(true)
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('nội dung mới')
    expect(seen.tools.at(-1)?.slice().sort()).toEqual(toolsFor('edit').sort())
    expect(lastEnd()).toMatchObject({ type: 'done' })
    expect(svc.pending('p1')).toBe(0)
  }, 30_000)

  it('(c) từ chối → tệp không được tạo, lượt vẫn kết thúc', async () => {
    await turn('viết c.txt', false)
    expect(existsSync(join(root, 'c.txt'))).toBe(false)
    expect(lastEnd()).toMatchObject({ type: 'done' })
    expect(svc.pending('p1')).toBe(0)
  }, 30_000)

  it('edit chờ duyệt từng bản diff, từ chối giữ nguyên và duyệt ghi bản đang xem', async () => {
    svc.setMode('p1', 'edit')
    const file = join(root, 'h.txt')
    writeFileSync(file, 'bản gốc\n')
    const rejected = await turn('sửa h.txt', false)
    expect(rejected).toContainEqual({ type: 'tool', name: 'edit', status: 'end', error: true })
    expect(readFileSync(file, 'utf8')).toBe('bản gốc\n')

    let beforeApproval = ''
    const approved = await turn('sửa h.txt', true, () => { beforeApproval = readFileSync(file, 'utf8') })
    expect(beforeApproval).toBe('bản gốc\n')
    expect(approved.find((event) => event.type === 'approval')).toMatchObject({
      request: { tool: 'edit', path: 'h.txt', before: 'bản gốc\n', after: 'bản đã duyệt\n' }
    })
    expect(approved).toContainEqual({ type: 'tool', name: 'edit', status: 'end', error: false })
    expect(readFileSync(file, 'utf8')).toBe('bản đã duyệt\n')
  }, 30_000)

  it('tệp được lưu trong lúc chờ duyệt diff → báo xung đột trong chat và giữ bản trên đĩa', async () => {
    svc.setMode('p1', 'edit')
    const file = join(root, 'f.txt')
    writeFileSync(file, 'gốc\n')
    const evs = await turn('sửa f.txt', true, () => writeFileSync(file, 'bản editor\n'))
    expect(evs.find((e) => e.type === 'approval')).toMatchObject({
      request: { tool: 'edit', path: 'f.txt', before: 'gốc\n', after: 'bản AI\n' },
    })
    expect(evs).toContainEqual({ type: 'tool', name: 'edit', status: 'end', error: true })
    expect(evs).toContainEqual({
      type: 'write_conflict',
      message: expect.stringContaining('Chưa ghi thay đổi. Hãy đọc lại tệp và duyệt bản xem trước mới.'),
    })
    expect(readFileSync(file, 'utf8')).toBe('bản editor\n')
    expect(lastEnd()).toMatchObject({ type: 'done' })
    expect(svc.pending('p1')).toBe(0)
  }, 30_000)

  it('(d) write với "@/tmp/…" ngoài dự án → không hỏi duyệt, không ghi gì', async () => {
    const evs = await turn('viết ngoài')
    expect(evs.some((e) => e.type === 'approval')).toBe(false)
    expect(existsSync(OUTSIDE)).toBe(false)
    expect(evs).toContainEqual({ type: 'tool', name: 'write', status: 'end', error: true })
  }, 30_000)

  it('dừng khi đang chờ duyệt → prompt() kết thúc với ai_cancelled, không còn yêu cầu treo, tệp không được tạo', async () => {
    const from = events.length
    const run = svc.prompt('p1', 'viết d.txt', target)
    while (!events.slice(from).some((e) => e.type === 'approval')) await new Promise((r) => setTimeout(r, 10))
    await svc.abort('p1')
    await run
    expect(lastEnd()).toEqual({ type: 'error', code: 'ai_cancelled', message: 'Đã dừng' })
    expect(events.slice(from).some((e) => e.type === 'approval_closed')).toBe(true)
    expect(existsSync(join(root, 'd.txt'))).toBe(false)
    expect(svc.pending('p1')).toBe(0)
  }, 30_000)

  it('nhà cung cấp trả 401 → error ai_unauthorized, lượt sau trên cùng phiên vẫn chạy', async () => {
    await turn('khoá sai')
    expect(lastEnd()).toEqual({ type: 'error', code: 'ai_unauthorized', message: 'API key bị từ chối' })
    await turn('chào')
    expect(lastEnd()).toMatchObject({ type: 'done', text: 'Xong [[a.py:1-1]]' })
  }, 30_000)

  it('không tự nạp chỉ dẫn bên ngoài ứng dụng vào system prompt', () => {
    expect(seen.bodies.length).toBeGreaterThan(0)
    for (const b of seen.bodies) {
      expect(b).not.toContain(MARK.root)
      expect(b).not.toContain(MARK.parent)
      expect(b).not.toContain(MARK.system)
      expect(b).not.toContain(MARK.append)
      expect(b).not.toContain(MARK.template)
      expect(b).not.toContain('run commands')
    }
  })

  it('chế độ Hỏi: read đường dẫn tuyệt đối ngoài dự án bị chặn, nội dung không đi tới mô hình', async () => {
    svc.setMode('p1', 'ask')
    const from = seen.bodies.length
    const evs = await turn('đọc ngoài')
    expect(evs).toContainEqual({ type: 'tool', name: 'read', status: 'end', error: true })
    const after = seen.bodies.slice(from).join('\n')
    expect(after).toContain('Đường dẫn nằm ngoài dự án')
    expect(after).not.toContain(MARK.outside)
  }, 30_000)

  it('khoá API không nằm dạng thường trong tệp nào dưới dataDir', () => {
    for (const f of filesUnder(dataDir)) expect(readFileSync(f, 'utf8')).not.toContain(KEY)
  })

  it('read với path vắng chứa dấu nháy thẳng bị chặn, không rơi vào biến thể dấu nháy cong là symlink ngoài', async ({ skip }) => {
    // a'b.txt không tồn tại; pi resolveReadPathAsync sẽ thử a’b.txt (cong) nếu được chạy — symlink trỏ ra ngoài
    const curly = join(root, 'a’b.txt')
    if (!createFileLink(OUTSIDE_READ, curly)) return skip('Windows thiếu quyền tạo symlink tệp.')
    svc.setMode('p1', 'ask')
    const from = seen.bodies.length
    const evs = await turn('đọc nháy')
    expect(evs).toContainEqual({ type: 'tool', name: 'read', status: 'end', error: true })
    const after = seen.bodies.slice(from).join('\n')
    expect(after).toContain('Tệp không tồn tại')
    expect(after).not.toContain(MARK.outside)
    rmSync(curly)
  }, 30_000)

  it('duyệt sau khi tệp đổi thành symlink trỏ ngoài → execute từ chối, tệp ngoài nguyên vẹn', async ({ skip }) => {
    const outsideFile = join(realpathSync.native(tmpdir()), `ng-pi-write-${process.pid}.txt`)
    writeFileSync(outsideFile, 'NGOAI\n')
    const outsideLink = join(root, 'e-outside-link')
    if (!createFileLink(outsideFile, outsideLink)) {
      rmSync(outsideFile, { force: true })
      return skip('Windows thiếu quyền tạo symlink tệp.')
    }
    writeFileSync(join(root, 'e.txt'), 'an toàn\n')
    svc.setMode('p1', 'edit')
    const from = events.length
    const run = svc.prompt('p1', 'ghi e.txt', target)
    while (!events.slice(from).some((e) => e.type === 'approval')) await new Promise((r) => setTimeout(r, 10))
    const approval = events.slice(from).find((e) => e.type === 'approval') as Extract<AgentEvent, { type: 'approval' }>
    expect(approval.request).toMatchObject({ tool: 'write', path: 'e.txt', before: 'an toàn\n', after: 'độc hại' })
    // giữa lúc preview, trước khi Duyệt: e.txt bị thay bằng symlink ra ngoài
    rmSync(join(root, 'e.txt'))
    renameSync(outsideLink, join(root, 'e.txt'))
    svc.approve('p1', approval.request.id, true)
    await run
    expect(events.slice(from)).toContainEqual({ type: 'tool', name: 'write', status: 'end', error: true })
    expect(readFileSync(outsideFile, 'utf8')).toBe('NGOAI\n')
    expect(lastEnd()).toMatchObject({ type: 'done' })
    expect(svc.pending('p1')).toBe(0)
    rmSync(join(root, 'e.txt'), { force: true })
    rmSync(outsideFile, { force: true })
  }, 30_000)

  it('SDK đổi endpoint sau khi kiểm đồng ý → chặn payload ở endpoint mới', async () => {
    const redirectedSeen = { auth: [] as string[], tools: [] as string[][], bodies: [] as string[] }
    const redirected = await fakeLlm(redirectedSeen)
    // recipient và hasConsent xác minh cùng đích trước lượt. Sau đó mô phỏng
    // SDK nhận endpoint OAuth khác ngay trước khi tạo request thật.
    const auth = vi.spyOn(accounts.modelRuntime, 'getAuth')
      .mockResolvedValueOnce({ auth: { apiKey: KEY, baseUrl: llm.url } } as Awaited<ReturnType<typeof accounts.modelRuntime.getAuth>>)
      .mockResolvedValueOnce({ auth: { apiKey: KEY, baseUrl: llm.url } } as Awaited<ReturnType<typeof accounts.modelRuntime.getAuth>>)
      .mockResolvedValueOnce({ auth: { apiKey: KEY, baseUrl: redirected.url } } as Awaited<ReturnType<typeof accounts.modelRuntime.getAuth>>)
    const requestCount = seen.bodies.length
    try {
      await svc.prompt('p1', 'chỉ gửi tới endpoint đã đồng ý', target)
      expect(lastEnd()).toMatchObject({ type: 'error', code: 'ai_provider_changed' })
      expect(auth).toHaveBeenCalled()
      expect(seen.bodies).toHaveLength(requestCount)
      expect(redirectedSeen.bodies).toHaveLength(0)
    } finally {
      auth.mockRestore()
      await redirected.close()
    }
  }, 30_000)

  it('SDK thật lưu hội thoại, checkpoint và hoàn tác sau khi đóng/mở lại dự án', async () => {
    svc.setMode('p1', 'edit')
    svc.setExecution('p1', { policy: 'auto', allowCommands: false })
    await turn('checkpoint lưu bền')
    const before = await svc.snapshot('p1')
    const sessionId = before.session!.id
    const taskId = before.task!.id
    expect(readFileSync(join(root, 'checkpoint.py'), 'utf8')).toBe('saved = True\n')
    expect(await svc.checkpoints('p1', taskId)).toMatchObject([{ path: 'checkpoint.py', before: '', after: 'saved = True\n' }])
    svc.close('p1')
    const restored = await svc.snapshot('p1')
    expect(restored.session?.id).toBe(sessionId)
    expect(restored.messages.at(-1)).toMatchObject({ text: 'Xong [[a.py:1-1]]', tools: [{ name: 'write', status: 'completed' }] })
    expect(svc.getExecution('p1')).toEqual({ policy: 'review', allowCommands: false })
    expect(await svc.rollback('p1', taskId)).toEqual({ restored: ['checkpoint.py'], conflicts: [] })
    expect(existsSync(join(root, 'checkpoint.py'))).toBe(false)
    expect(await svc.checkpoints('p1', taskId)).toMatchObject([{ restored: true }])
    expect((await svc.snapshot('p1')).task?.checkpointIds).toEqual([])
  }, 30_000)

  it('nhà cung cấp OpenAI-compatible trả 307 → không chuyển payload hoặc API key sang máy chủ khác', async () => {
    const firstSeen = { auth: [] as string[], tools: [] as string[][], bodies: [] as string[] }
    const secondSeen = { auth: [] as string[], tools: [] as string[][], bodies: [] as string[] }
    const second = await fakeLlm(secondSeen)
    const first = await fakeLlm(firstSeen, `${second.url}/chat/completions`)
    try {
      await accounts.saveCustomProvider({ id: 'redirect', label: 'Redirect', baseUrl: first.url, model: 'fake-1' }, KEY)
      accounts.selectModel('redirect', 'fake-1')
      svc.selectionChanged()
      const redirectTarget = (await accounts.getConsentTarget())!
      await accounts.grantConsent('p1', redirectTarget)
      await svc.prompt('p1', 'chỉ gửi nội dung đến đích ban đầu', redirectTarget)

      expect(lastEnd()).toMatchObject({ type: 'error' })
      expect(firstSeen.bodies.some((body) => body.includes('chỉ gửi nội dung đến đích ban đầu'))).toBe(true)
      expect(secondSeen.bodies).toHaveLength(0)
      expect(secondSeen.auth).toHaveLength(0)
    } finally {
      accounts.selectModel('fake', 'fake-1')
      svc.selectionChanged()
      await Promise.all([first.close(), second.close()])
    }
  }, 30_000)

  it('đổi nhà cung cấp lúc đang duyệt thao tác → huỷ lượt và phiên mới không nhận lịch sử cũ', async () => {
    svc.setMode('p1', 'ask')
    const marker = 'PRIVATE-TOOL-RESULT-c919'
    writeFileSync(join(root, 'marker.txt'), marker)
    await turn('đọc marker.txt')
    expect(seen.bodies.at(-1)?.includes(marker)).toBe(true)
    await accounts.saveCustomProvider({ id: 'fake', label: 'Fake', baseUrl: llm.url, model: 'fake-2' })
    accounts.selectModel('fake', 'fake-2')
    svc.selectionChanged()
    await turn('tiếp tục với model khác cùng đích nhận')
    expect(seen.bodies.at(-1)?.includes(marker)).toBe(true)

    const secondSeen = { auth: [] as string[], tools: [] as string[][], bodies: [] as string[] }
    const second = await fakeLlm(secondSeen)
    try {
      await accounts.saveCustomProvider({ id: 'fake-b', label: 'Fake B', baseUrl: second.url, model: 'fake-1' })
      svc.setMode('p1', 'edit')
      const from = events.length
      const run = svc.prompt('p1', 'viết g.txt', target)
      const approval = await vi.waitFor(() => {
        const event = events.slice(from).find((e) => e.type === 'approval')
        if (!event) throw new Error('không thấy sự kiện approval')
        return event.request
      }, { timeout: 10_000 })
      const requestsBeforeSwitch = seen.bodies.length

      accounts.selectModel('fake-b', 'fake-1')
      svc.selectionChanged()
      svc.approve('p1', approval.id, true)
      await run

      expect(lastEnd()).toMatchObject({ type: 'error', code: 'ai_provider_changed' })
      expect(svc.pending('p1')).toBe(0)
      expect(existsSync(join(root, 'g.txt'))).toBe(false)
      expect(seen.bodies).toHaveLength(requestsBeforeSwitch)
      await expect(svc.prompt('p1', 'dùng lựa chọn cũ', target)).rejects.toMatchObject({ code: 'ai_provider_changed' })
      const secondTarget = (await accounts.getConsentTarget())!
      await expect(svc.prompt('p1', 'chưa đồng ý', secondTarget)).rejects.toMatchObject({ code: 'consent_required' })
      expect(secondSeen.bodies).toHaveLength(0)

      await accounts.grantConsent('p1', secondTarget)
      await svc.prompt('p1', 'bắt đầu với nhà cung cấp mới', secondTarget)
      expect(lastEnd()).toMatchObject({ type: 'done' })
      expect(secondSeen.bodies).toHaveLength(1)
      expect(secondSeen.bodies[0]).toContain('bắt đầu với nhà cung cấp mới')
      expect(secondSeen.bodies[0]).not.toContain(marker)
      expect(secondSeen.bodies[0]).not.toContain('viết g.txt')
    } finally {
      await second.close()
    }
  }, 30_000)
})
