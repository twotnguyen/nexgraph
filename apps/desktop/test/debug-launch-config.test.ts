import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DebugEvent } from '../src/shared/api'
import { adapterDir, adapterInstalled, installAdapter, type DebugKind } from '../src/main/debug/adapters'
import { attachSpec, ensureConfigFile, launchSpec, listConfigs, parseConfigs, resolveConfig, toSpec } from '../src/main/debug/launch-config'
import { DebugManager } from '../src/main/debug/manager'

const LAUNCH_JSON = `{
  // Cấu hình mẫu: chú thích và dấu phẩy cuối đều hợp lệ trong launch.json của VS Code.
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: app", // chú thích cuối dòng
      "type": "debugpy",
      "request": "launch",
      "program": "\${workspaceFolder}/app.py",
      "args": ["--n", "\${env:NG_TEST_N}", "\${fileBasename}"],
      "env": { "MODE": "dev", "DIR": "\${fileDirname}", "URL": "http://x//y" },
      "stopOnEntry": true,
      /* chú thích khối với dấu ] và , */
      "cwd": "\${workspaceFolder}/sub",
    },
    { "name": "Node attach", "type": "node", "request": "attach", "port": 9229, },
    { "name": "Chrome", "type": "chrome", "request": "launch", "url": "http://localhost" },
    { "name": "Theo PID", "type": "node", "request": "attach", "processId": "\${command:PickProcess}" },
    { "type": "node", "request": "launch", "program": "thieu-ten.js" },
  ],
}`

const ZED_JSON = `[
  // debug.json của Zed/Wu: label + adapter thay cho name + type
  { "label": "Debug active Python file", "adapter": "Debugpy", "program": "$ZED_FILE", "request": "launch", "cwd": "$ZED_WORKTREE_ROOT", "args": ["$ZED_FILENAME"], },
  { "label": "Debug active JavaScript file", "adapter": "JavaScript", "type": "pwa-node", "program": "$ZED_FILE", "request": "launch" },
  { "label": "Attach py", "adapter": "Debugpy", "request": "attach", "connect": { "host": "10.0.0.5", "port": 7000 } },
  { "label": "Debugpy lắng nghe", "adapter": "Debugpy", "request": "attach", "listen": { "port": 5678 } },
]`

const root = realpathSync.native(tmpdir())
const find = (configs: ReturnType<typeof parseConfigs>, name: string) => configs.find((config) => config.name === name)!

describe('đọc cấu hình', () => {
  it('launch.json: bỏ chú thích và dấu phẩy cuối, chỉ giữ node/python launch/attach có tên và không theo PID', () => {
    const configs = parseConfigs('.vscode/launch.json', LAUNCH_JSON)
    expect(configs.map(({ name, source, kind, request }) => ({ name, source, kind, request }))).toEqual([
      { name: 'Python: app', source: '.vscode/launch.json', kind: 'python', request: 'launch' },
      { name: 'Node attach', source: '.vscode/launch.json', kind: 'node', request: 'attach' }
    ])
  })

  it('debug.json của Zed: label/adapter, bỏ cấu hình listen', () => {
    expect(parseConfigs('.zed/debug.json', ZED_JSON).map(({ name, kind, request }) => ({ name, kind, request }))).toEqual([
      { name: 'Debug active Python file', kind: 'python', request: 'launch' },
      { name: 'Debug active JavaScript file', kind: 'node', request: 'launch' },
      { name: 'Attach py', kind: 'python', request: 'attach' }
    ])
  })

  it('báo lỗi rõ khi tệp sai cú pháp hoặc không có danh sách', () => {
    expect(() => parseConfigs('.vscode/launch.json', '{ "configurations": [ ')).toThrow(expect.objectContaining({ code: 'invalid_debug_config' }))
    expect(() => parseConfigs('.vscode/launch.json', '{ "configurations": 3 }')).toThrow(expect.objectContaining({ code: 'invalid_debug_config' }))
    expect(parseConfigs('.vscode/launch.json', '{ "version": "0.2.0" }')).toEqual([])
  })
})

describe('đổi cấu hình thành tham số adapter', () => {
  const project = join(root, 'proj')
  const file = join(project, 'src', 'main.py')
  afterEach(() => vi.unstubAllEnvs())

  it('launch: thay ${workspaceFolder}, ${fileDirname}, ${env:X} và giữ args/env/cwd/stopOnEntry', () => {
    vi.stubEnv('NG_TEST_N', '7')
    const spec = toSpec(find(parseConfigs('.vscode/launch.json', LAUNCH_JSON), 'Python: app'), project, file)
    expect(spec).toEqual({
      kind: 'python',
      request: 'launch',
      args: {
        type: 'python', request: 'launch', console: 'internalConsole', justMyCode: true, stopOnEntry: true,
        program: `${project}/app.py`,
        cwd: join(project, 'sub'),
        // ${fileBasename} nằm ngoài danh sách biến hỗ trợ: giữ nguyên thay vì đoán.
        args: ['--n', '7', '${fileBasename}'],
        env: { MODE: 'dev', DIR: join(project, 'src'), URL: 'http://x//y' }
      }
    })
  })

  it('launch: biến $ZED_* của debug.json, không cắt nhầm $ZED_FILENAME; node dùng pwa-node', () => {
    const [python, node] = parseConfigs('.zed/debug.json', ZED_JSON)
    expect(toSpec(python, project, file).args).toMatchObject({ program: file, cwd: project, args: ['$ZED_FILENAME'] })
    expect(toSpec(node, project, file)).toEqual({
      kind: 'node', request: 'launch',
      args: { type: 'pwa-node', request: 'launch', program: file, cwd: project, console: 'internalConsole', outputCapture: 'std' }
    })
  })

  it('launch: ${file} cần tệp đang mở, thiếu program hoặc args sai kiểu là lỗi người dùng', () => {
    const config = find(parseConfigs('x.json', '[{"name":"a","type":"node","request":"launch","program":"${file}"}]'), 'a')
    expect(() => toSpec(config, project)).toThrow(expect.objectContaining({ code: 'bad_debug_config', message: expect.stringContaining('${file}') }))
    expect(() => toSpec(find(parseConfigs('x.json', '[{"name":"a","type":"node","request":"launch"}]'), 'a'), project)).toThrow('thiếu "program"')
    expect(() => toSpec(find(parseConfigs('x.json', '[{"name":"a","type":"node","request":"launch","program":"x.js","args":"--flag"}]'), 'a'), project)).toThrow('"args"')
  })

  it('cấu hình mặc định (F5 không chọn gì) giữ đúng tham số cũ', () => {
    expect(launchSpec('python', { program: '/p/a.py', cwd: '/p' })).toEqual({
      kind: 'python', request: 'launch',
      args: { type: 'python', request: 'launch', program: '/p/a.py', cwd: '/p', console: 'internalConsole', justMyCode: true }
    })
    expect(launchSpec('node', { program: '/p/a.js', cwd: '/p' }).args).toEqual({ type: 'pwa-node', request: 'launch', program: '/p/a.js', cwd: '/p', console: 'internalConsole', outputCapture: 'std' })
  })

  it('attach Node: cổng inspector, mặc định localhost:9229', () => {
    expect(toSpec(find(parseConfigs('.vscode/launch.json', LAUNCH_JSON), 'Node attach'), project)).toEqual({
      kind: 'node', request: 'attach', host: 'localhost', port: 9229, args: { type: 'pwa-node', request: 'attach', address: 'localhost', port: 9229 }
    })
    const [custom] = parseConfigs('x.json', '[{"name":"n","type":"pwa-node","request":"attach","address":"10.1.1.1","port":9230}]')
    expect(toSpec(custom, project).args).toMatchObject({ address: '10.1.1.1', port: 9230 })
  })

  it('attach Python: connect {host, port} hoặc host/port ở ngoài, mặc định 127.0.0.1:5678', () => {
    const [connect] = parseConfigs('.zed/debug.json', ZED_JSON).slice(2)
    expect(toSpec(connect, project)).toEqual({
      kind: 'python', request: 'attach', host: '10.0.0.5', port: 7000, args: { type: 'python', request: 'attach', connect: { host: '10.0.0.5', port: 7000 }, justMyCode: true }
    })
    const [flat, bare] = parseConfigs('x.json', '[{"name":"f","type":"python","request":"attach","host":"h.local","port":"${env:NG_TEST_PORT}"},{"name":"b","type":"debugpy","request":"attach"}]')
    vi.stubEnv('NG_TEST_PORT', '6001')
    expect(toSpec(flat, project).args).toMatchObject({ connect: { host: 'h.local', port: 6001 } })
    expect(toSpec(bare, project).args).toMatchObject({ connect: { host: '127.0.0.1', port: 5678 } })
  })

  it('attach: từ chối cổng ngoài khoảng, không phải số hoặc địa chỉ lạ', () => {
    for (const [host, port] of [['localhost', 0], ['localhost', 70000], ['localhost', 1.5], ['localhost', Number('abc')], ['localhost', '9229'], ['a b', 9229], ['', 9229], ['x;rm', 9229]] as const) {
      expect(() => attachSpec('node', host, port)).toThrow(expect.objectContaining({ code: 'bad_debug_config' }))
    }
    expect(attachSpec('python', '::1', 5678).args).toMatchObject({ connect: { host: '::1', port: 5678 } })
  })
})

describe('tệp cấu hình trong dự án', () => {
  let dir: string
  beforeEach(() => { dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ng-dbg-cfg-'))) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const write = (path: string, text: string) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text) }

  it('liệt kê cả launch.json lẫn debug.json; dự án chưa có tệp nào thì rỗng', async () => {
    expect(await listConfigs(dir)).toEqual([])
    write('.vscode/launch.json', LAUNCH_JSON)
    write('.zed/debug.json', ZED_JSON)
    const list = await listConfigs(dir)
    expect(list.map((item) => `${item.source}|${item.name}|${item.kind}|${item.request}`)).toEqual([
      '.vscode/launch.json|Python: app|python|launch',
      '.vscode/launch.json|Node attach|node|attach',
      '.zed/debug.json|Debug active Python file|python|launch',
      '.zed/debug.json|Debug active JavaScript file|node|launch',
      '.zed/debug.json|Attach py|python|attach'
    ])
  })

  it('tệp hỏng báo lỗi thay vì trả danh sách thiếu', async () => {
    write('.vscode/launch.json', '{ "configurations": [ { "name": ')
    await expect(listConfigs(dir)).rejects.toMatchObject({ code: 'invalid_debug_config' })
  })

  it('chọn theo (tệp, tên); ${file} là đường dẫn thật của tệp đang mở', async () => {
    write('.vscode/launch.json', '{ "configurations": [ { "name": "run", "type": "node", "request": "launch", "program": "${file}", "cwd": "${workspaceFolder}" } ] }')
    write('src/a.js', '')
    const spec = await resolveConfig(dir, '.vscode/launch.json', 'run', 'src/a.js')
    expect(spec.args).toMatchObject({ program: join(dir, 'src', 'a.js'), cwd: dir })
    await expect(resolveConfig(dir, '.vscode/launch.json', 'khong-co')).rejects.toMatchObject({ code: 'no_debug_config' })
    await expect(resolveConfig(dir, '.zed/debug.json', 'run')).rejects.toMatchObject({ code: 'no_debug_config' })
    await expect(resolveConfig(dir, '.vscode/launch.json', 'run', '../ngoai.js')).rejects.toBeDefined()
    await expect(resolveConfig(dir, '.vscode/launch.json', 'run')).rejects.toMatchObject({ code: 'bad_debug_config' })
  })

  it('tạo launch.json mẫu đọc lại được và không ghi đè tệp có sẵn', async () => {
    expect(await ensureConfigFile(dir)).toBe('.vscode/launch.json')
    expect((await listConfigs(dir)).map((item) => `${item.kind}|${item.request}`)).toEqual(['python|launch', 'node|launch', 'python|attach', 'node|attach'])
    write('.vscode/launch.json', '// của người dùng\n{ "configurations": [] }')
    expect(await ensureConfigFile(dir)).toBe('.vscode/launch.json')
    expect(readFileSync(join(dir, '.vscode/launch.json'), 'utf8')).toBe('// của người dùng\n{ "configurations": [] }')
  })

  it('chỉ có .zed/debug.json thì mở tệp đó và không tạo .vscode', async () => {
    write('.zed/debug.json', '[]')
    expect(await ensureConfigFile(dir)).toBe('.zed/debug.json')
    await expect(listConfigs(dir)).resolves.toEqual([])
    expect(() => statSync(join(dir, '.vscode'))).toThrow()
  })
})

type FakeRequest = { seq: number; command: string; arguments?: Record<string, unknown> }

const portOf = (server: Server): number => {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('máy chủ chưa nghe cổng nào')
  return address.port
}

// Adapter debugpy giả trên TCP, như debugpy.listen của tiến trình đích: trả lời attach sau configurationDone rồi báo dừng ở điểm dừng.
async function fakeDebugpy() {
  const received: FakeRequest[] = []
  const sockets: Socket[] = []
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.on('error', () => {})
    let buffer = Buffer.alloc(0)
    let attach: FakeRequest | null = null
    let seq = 1
    const send = (message: object) => { const body = Buffer.from(JSON.stringify({ seq: seq++, ...message })); socket.write(`Content-Length: ${body.length}\r\n\r\n`); socket.write(body) }
    const reply = (request: FakeRequest) => send({ type: 'response', request_seq: request.seq, command: request.command, success: true, body: {} })
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const end = buffer.indexOf('\r\n\r\n')
        if (end < 0) return
        const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1])
        if (buffer.length < end + 4 + length) return
        const request: FakeRequest = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
        buffer = buffer.subarray(end + 4 + length)
        received.push(request)
        if (request.command === 'attach') { attach = request; send({ type: 'event', event: 'initialized' }) } else reply(request)
        if (request.command === 'configurationDone') {
          if (attach) reply(attach)
          send({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } })
        }
        if (request.command === 'disconnect') socket.end()
      }
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  return { port: portOf(server), received, sockets, close: () => { for (const socket of sockets) socket.destroy(); server.close() } }
}

const freePort = () => new Promise<number>((ok) => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const port = portOf(server); server.close(() => ok(port)) })
})

describe('attach Python qua TCP (adapter giả)', () => {
  it('gửi attach/connect, dừng ở điểm dừng và chỉ ngắt kết nối khi Dừng (không tắt tiến trình đích)', async () => {
    const adapter = await fakeDebugpy()
    const events: DebugEvent[] = []
    const manager = new DebugManager('/khong-dung', (event) => events.push(event))
    try {
      await manager.run(root, attachSpec('python', '127.0.0.1', adapter.port), { 'app.py': [{ line: 3, enabled: true }] })
      expect(adapter.received.map((request) => request.command)).toEqual(['initialize', 'attach', 'setBreakpoints', 'configurationDone'])
      expect(adapter.received[1].arguments).toEqual({ type: 'python', request: 'attach', connect: { host: '127.0.0.1', port: adapter.port }, justMyCode: true })
      expect(adapter.received[2].arguments).toMatchObject({ source: { path: join(root, 'app.py') }, breakpoints: [{ line: 3 }] })
      await vi.waitFor(() => expect(events).toContainEqual({ type: 'state', state: 'stopped', reason: 'breakpoint', threadId: 1 }))
      await manager.stop()
      expect(adapter.received.at(-1)).toMatchObject({ command: 'disconnect', arguments: { terminateDebuggee: false } })
      expect(events.at(-1)).toEqual({ type: 'state', state: 'terminated' })
    } finally { adapter.close() }
  })

  it('tiến trình đích thoát (socket đóng) thì phiên kết thúc', async () => {
    const adapter = await fakeDebugpy()
    const events: DebugEvent[] = []
    const manager = new DebugManager('/khong-dung', (event) => events.push(event))
    try {
      await manager.run(root, attachSpec('python', '127.0.0.1', adapter.port), {})
      for (const socket of adapter.sockets) socket.destroy()
      await vi.waitFor(() => expect(events.at(-1)).toEqual({ type: 'state', state: 'terminated' }))
    } finally { adapter.close() }
  })

  it('cổng không có ai nghe: báo lỗi kết nối và về trạng thái kết thúc', async () => {
    const events: DebugEvent[] = []
    const manager = new DebugManager('/khong-dung', (event) => events.push(event))
    const port = await freePort()
    await expect(manager.run(root, attachSpec('python', '127.0.0.1', port), {})).rejects.toMatchObject({ code: 'connect_failed', message: expect.stringContaining(String(port)) })
    expect(events.at(-1)).toEqual({ type: 'state', state: 'terminated' })
  })
})

// Chạy adapter thật (tải js-debug và debugpy về thư mục tạm): NEXGRAPH_DEBUG_IT=1 pnpm exec vitest run test/debug-launch-config.test.ts
describe.skipIf(!process.env.NEXGRAPH_DEBUG_IT)('cấu hình và attach với js-debug và debugpy', () => {
  const base = mkdtempSync(join(tmpdir(), 'ng-dbg-adapters-'))
  const project = realpathSync.native(mkdtempSync(join(tmpdir(), 'ng-dbg-proj-')))
  const children: ChildProcess[] = []
  beforeAll(async () => {
    for (const kind of ['node', 'python'] as DebugKind[]) if (!adapterInstalled(base, kind)) await installAdapter(base, kind)
    mkdirSync(join(project, '.vscode'))
  }, 120_000)
  afterEach(() => { for (const child of children.splice(0)) child.kill() })
  afterAll(() => { rmSync(base, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true }) })

  const waitFor = (events: DebugEvent[], state: string, from = 0) =>
    vi.waitFor(() => expect(events.slice(from).some((event) => event.type === 'state' && event.state === state)).toBe(true), { timeout: 30_000 })
  const stoppedThread = (events: DebugEvent[]): number => {
    for (const event of events) if (event.type === 'state' && event.state === 'stopped') return event.threadId ?? 0
    throw new Error('chưa có sự kiện dừng')
  }
  const outputOf = (events: DebugEvent[]) => events.flatMap((event) => (event.type === 'output' ? [event.text] : [])).join('')

  // Tiến trình đích ghi thêm một byte mỗi vòng: kích thước tệp tăng nghĩa là nó đang chạy (không bị treo ở điểm dừng, không bị tắt).
  const expectRunning = async (progress: string) => {
    const before = statSync(progress).size
    await vi.waitFor(() => expect(statSync(progress).size).toBeGreaterThan(before), { timeout: 10_000 })
  }
  const target = async (command: string, args: string[], ready: RegExp, env: NodeJS.ProcessEnv = {}): Promise<ChildProcess> => {
    const child = spawn(command, args, { cwd: project, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let text = ''
    for (const stream of [child.stdout!, child.stderr!]) stream.on('data', (chunk: Buffer) => { text += chunk.toString() })
    await vi.waitFor(() => expect(ready.test(text), `tiến trình đích chưa sẵn sàng (thoát: ${child.exitCode}): ${text}`).toBe(true), { timeout: 20_000 })
    return child
  }

  it('launch Python từ launch.json: dừng đúng điểm dừng, nhận args và env', async () => {
    writeFileSync(join(project, '.vscode', 'launch.json'), `{
      // launch.json
      "configurations": [
        { "name": "Python: app", "type": "debugpy", "request": "launch", "program": "\${workspaceFolder}/app.py", "args": ["--n", "7"], "env": { "NG_MODE": "dev" }, },
        { "name": "Node: attach", "type": "node", "request": "attach", "port": 9229 },
      ],
    }`)
    writeFileSync(join(project, 'app.py'), 'import os, sys\ntotal = 0\nfor n in range(3):\n    total += n\nprint("mode", os.environ.get("NG_MODE"), sys.argv[1:], total)\n')
    expect((await listConfigs(project)).map((item) => `${item.name}|${item.request}`)).toEqual(['Python: app|launch', 'Node: attach|attach'])
    const events: DebugEvent[] = []
    const manager = new DebugManager(base, (event) => events.push(event))
    try {
      await manager.run(project, await resolveConfig(project, '.vscode/launch.json', 'Python: app'), { 'app.py': [{ line: 4, enabled: true }] })
      await waitFor(events, 'stopped')
      const [top] = await manager.stackTrace(stoppedThread(events))
      expect(top).toMatchObject({ file: 'app.py', line: 4 })
      await manager.setBreakpoints('app.py', [{ line: 4, enabled: false }])
      await manager.step('continue', stoppedThread(events))
      await waitFor(events, 'terminated')
      expect(outputOf(events)).toContain("mode dev ['--n', '7'] 3")
    } finally { await manager.stop() }
  }, 90_000)

  it('attach Node: node --inspect, dừng ở điểm dừng trong tệp, Dừng chỉ ngắt kết nối', async () => {
    const port = await freePort()
    const progress = join(project, 'node-progress')
    writeFileSync(progress, '')
    writeFileSync(join(project, 'x.js'), `const fs = require('fs')\nlet n = 0\nsetInterval(() => {\n  n += 1\n  fs.appendFileSync(${JSON.stringify(progress)}, '.')\n}, 50)\nconsole.log('ready')\n`)
    writeFileSync(join(project, '.vscode', 'launch.json'), `{ "configurations": [ { "name": "Node: attach", "type": "node", "request": "attach", "port": ${port} } ] }`)
    const child = await target(process.execPath, [`--inspect=${port}`, 'x.js'], /Debugger listening/)
    const events: DebugEvent[] = []
    const manager = new DebugManager(base, (event) => events.push(event))
    try {
      await manager.run(project, await resolveConfig(project, '.vscode/launch.json', 'Node: attach'), { 'x.js': [{ line: 4, enabled: true }] })
      await waitFor(events, 'stopped')
      const [top] = await manager.stackTrace(stoppedThread(events))
      expect(top).toMatchObject({ file: 'x.js', line: 4 })
      await manager.stop()
      expect(child.exitCode).toBeNull()
      await expectRunning(progress)
    } finally { await manager.stop() }
  }, 90_000)

  it('attach Python: debugpy.listen, dừng ở điểm dừng, Dừng chỉ ngắt kết nối', async () => {
    const port = await freePort()
    const progress = join(project, 'py-progress')
    writeFileSync(progress, '')
    writeFileSync(join(project, 'serve.py'), `import debugpy, time\ndebugpy.listen(("127.0.0.1", ${port}))\nprint("ready", flush=True)\nwhile True:\n    open(${JSON.stringify(progress)}, "a").write(".")\n    time.sleep(0.05)\n`)
    writeFileSync(join(project, '.vscode', 'launch.json'), `{ "configurations": [ { "name": "Py: attach", "type": "debugpy", "request": "attach", "connect": { "host": "127.0.0.1", "port": ${port} } } ] }`)
    // debugpy của tiến trình đích: bản đã tải cho adapter, đưa vào PYTHONPATH như người dùng pip install debugpy.
    const child = await target('python3', ['serve.py'], /ready/, { PYTHONPATH: adapterDir(base, 'python'), PYDEVD_DISABLE_FILE_VALIDATION: '1' })
    const events: DebugEvent[] = []
    // Thư mục adapter không tồn tại: attach Python không được dùng đến nó.
    const manager = new DebugManager(join(base, 'khong-co'), (event) => events.push(event))
    try {
      await manager.run(project, await resolveConfig(project, '.vscode/launch.json', 'Py: attach'), { 'serve.py': [{ line: 5, enabled: true }] })
      await waitFor(events, 'stopped')
      const [top] = await manager.stackTrace(stoppedThread(events))
      expect(top).toMatchObject({ file: 'serve.py', line: 5 })
      await manager.stop()
      expect(child.exitCode).toBeNull()
      await expectRunning(progress)
    } finally { await manager.stop() }
  }, 90_000)

  // Tiến trình đích tự thoát khi đang attach: phiên phải kết thúc thay vì treo ở "đang chạy".
  for (const kind of ['node', 'python'] as const) {
    it(`attach ${kind}: tiến trình đích thoát thì phiên kết thúc`, async () => {
      const port = await freePort()
      const events: DebugEvent[] = []
      const manager = new DebugManager(base, (event) => events.push(event))
      if (kind === 'node') {
        writeFileSync(join(project, 'short.js'), "setTimeout(() => process.exit(0), 5000)\nconsole.log('ready')\n")
        await target(process.execPath, [`--inspect=${port}`, 'short.js'], /Debugger listening/)
      } else {
        writeFileSync(join(project, 'short.py'), `import debugpy, time\ndebugpy.listen(("127.0.0.1", ${port}))\nprint("ready", flush=True)\ntime.sleep(5)\n`)
        await target('python3', ['short.py'], /ready/, { PYTHONPATH: adapterDir(base, 'python'), PYDEVD_DISABLE_FILE_VALIDATION: '1' })
      }
      try {
        await manager.run(project, attachSpec(kind, kind === 'node' ? 'localhost' : '127.0.0.1', port), {})
        await waitFor(events, 'terminated')
      } finally { await manager.stop() }
    }, 90_000)
  }
})
