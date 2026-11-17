import type { NexGraphApi } from '../shared/api'
import type { AiConsentTarget } from '../shared/agent-types'

/** Chạy nguyên hàm trong renderer của bản cài để kiểm cả contextBridge và IPC. */
export async function runRendererSmoke(api: NexGraphApi, root: string, baseUrl: string): Promise<string> {
  const project = await api.project.open(root)
  if (!project.path.normalize('NFC').includes('Đồ án') || project.is_git !== false) {
    throw new Error('acceptance fixture must use a source path with spaces, Vietnamese characters, and no Git repository')
  }
  const pid = project.project_id
  const filename = 'smoke.ts'
  const caller = 'caller.ts'
  const callLine = '  return smokeHelper()'
  const source = [
    'export function smokeHelper(): boolean {',
    '  return true',
    '}',
    '',
    'export function smokeEntry(): boolean {',
    callLine,
    '}',
    ''
  ].join('\n')
  const callerSource = [
    "import { smokeHelper } from './smoke'",
    '',
    'export function smokeExternal(): boolean {',
    callLine,
    '}',
    ''
  ].join('\n')
  const format = { eol: '\r\n', bom: true } as const
  const created = await api.fs.write(pid, filename, source, { ...format, expectedVersion: null })
  const file = await api.fs.read(pid, filename)
  if (file.text !== source || file.eol !== format.eol || !file.bom || file.readOnly ||
    !created.version || file.version !== created.version) {
    throw new Error('fs IPC roundtrip failed')
  }
  const [duplicate] = await Promise.allSettled([
    api.fs.write(pid, filename, 'should not replace the source', { ...format, expectedVersion: null })
  ])
  if (duplicate.status !== 'rejected' || duplicate.reason?.code !== 'conflict') {
    throw new Error('fs IPC allowed a conflicting file creation')
  }

  const edits = [source + '// save A\n', source + '// save B\n']
  const saves = await Promise.allSettled(edits.map((text) =>
    api.fs.write(pid, filename, text, { ...format, expectedVersion: file.version })
  ))
  const saved = await api.fs.read(pid, filename)
  const winner = saves.findIndex((result) => result.status === 'fulfilled')
  const success = saves[winner]
  const rejected = saves[1 - winner]
  if (success?.status !== 'fulfilled' || rejected?.status !== 'rejected' || rejected.reason?.code !== 'conflict' ||
    saved.text !== edits[winner] || saved.version !== success.value.version || saved.eol !== format.eol || !saved.bom) {
    throw new Error('fs IPC failed the concurrent save check')
  }
  await api.fs.write(pid, filename, source, { ...format, expectedVersion: saved.version })
  await api.fs.write(pid, caller, callerSource, { eol: '\n', bom: false, expectedVersion: null })

  // SSE báo lỗi sớm nếu đã nối. Kiểm mốc hoàn tất qua IPC để không lỡ job ngắn khi SSE nối muộn.
  if (project.last_indexed_at != null) throw new Error('index smoke requires a fresh project')
  const failures = new Map<string, string>()
  const offIndex = api.index.onEvent((event) => {
    if (event.type !== 'job_progress' || event.project_id !== pid) return
    if (event.state === 'error' || event.state === 'cancelled') {
      failures.set(event.job_id, event.message ?? event.state)
    }
  })
  try {
    const { jobId } = await api.index.start(pid)
    const deadline = Date.now() + 20_000
    while (true) {
      const failure = failures.get(jobId)
      if (failure !== undefined) throw new Error(`index IPC failed: ${failure}`)
      const projects = await api.project.list()
      if (projects.some((candidate) => candidate.project_id === pid && candidate.last_indexed_at != null)) break
      if (Date.now() >= deadline) throw new Error('index IPC timed out waiting for a completed graph')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } finally {
    offIndex()
  }

  const hits = await api.graph.search(pid, 'smokeEntry', { kinds: ['function'] })
  const entry = hits.find(({ node }) => node.label === 'smokeEntry' && node.file === filename)?.node
  if (!entry || entry.line_start !== 5) throw new Error('graph IPC did not find smokeEntry at smoke.ts:5')
  const neighbors = await api.graph.neighbors(pid, { node: entry.id, types: ['CALLS'], direction: 'out', depth: 1 })
  const helper = neighbors.nodes.find((node) => node.label === 'smokeHelper' && node.file === filename)
  if (!helper || !neighbors.edges.some((edge) => edge.type === 'CALLS' && edge.source === entry.id &&
    edge.target === helper.id && edge.evidence?.file === filename && edge.evidence.line === 6)) {
    throw new Error('graph IPC did not find the smokeEntry call at smoke.ts:6')
  }
  const code = await api.graph.code(pid, filename, 6, 6)
  if (code.file !== filename || code.start !== 6 || code.end !== 6 || code.text !== callLine || code.stale !== false) {
    throw new Error('graph IPC did not return the code at smoke.ts:6')
  }

  const callerHits = await api.graph.search(pid, 'smokeExternal', { kinds: ['function'] })
  const external = callerHits.find(({ node }) => node.label === 'smokeExternal' && node.file === caller)?.node
  if (!external) throw new Error('graph IPC did not find the caller in the second source file')
  const externalCalls = await api.graph.neighbors(pid, { node: external.id, types: ['CALLS'], direction: 'out', depth: 1 })
  if (!externalCalls.edges.some((edge) => edge.type === 'CALLS' && edge.source === external.id &&
    edge.target === helper.id && edge.evidence?.file === caller && edge.evidence.line === 4)) {
    throw new Error('graph IPC did not return cross-file call evidence at caller.ts:4')
  }
  const clean = await api.graph.changes(pid, { refresh: false })
  if (clean.base !== 'last_index' || clean.base_commit !== null || clean.changed_files.length !== 0) {
    throw new Error('the freshly published no-Git baseline is not clean')
  }

  async function selectProvider(id: string, endpoint: string): Promise<AiConsentTarget> {
    await api.auth.saveCustom({ id, label: id, baseUrl: endpoint, model: 'fake' })
    await api.auth.selectModel(id, 'fake')
    const settings = await api.ai.getSettings()
    if (settings.provider !== id || settings.baseUrl !== endpoint) {
      throw new Error(`agent IPC did not expose the selected smoke provider ${id}`)
    }
    const target = { provider: settings.provider, baseUrl: settings.baseUrl }
    await api.ai.grantConsent(pid, target)
    return target
  }

  const target = await selectProvider('smoke', baseUrl)
  const expectedEdit = source.replace('  return true', '  return false')
  const original = await api.fs.read(pid, filename)

  async function prompt(question: string, options: {
    decision?: 'deny' | 'stop' | 'approve'; destination?: AiConsentTarget; expected?: string
  } = {}): Promise<void> {
    const { decision, destination = target, expected = decision === 'stop' ? 'error:ai_cancelled'
      : question === 'NEXGRAPH_SMOKE' ? 'done:NEXGRAPH_SMOKE_OK' : 'done:NEXGRAPH_SMOKE_POLICY_OK' } = options
    let approvals = 0
    let unexpectedDiff = false
    let streamed = 0
    const actions: Promise<void>[] = []
    let finish!: (result: string) => void
    const terminal = new Promise<string>((resolve) => { finish = resolve })
    const off = api.agent.onEvent((eventPid, event) => {
      if (eventPid !== pid) return
      if (event.type === 'text') streamed += event.delta.length
      if (event.type === 'done') finish(`done:${event.text}`)
      if (event.type === 'error') finish(`error:${event.code}`)
      if (event.type !== 'approval') return
      approvals++
      const diff = event.request
      if (!decision || diff.tool !== 'edit' || diff.path !== filename || diff.before !== source || diff.after !== expectedEdit) {
        unexpectedDiff = true
        actions.push(api.agent.approve(pid, diff.id, false))
      } else if (decision === 'stop') {
        actions.push(api.agent.abort(pid))
      } else {
        actions.push(api.agent.approve(pid, diff.id, decision === 'approve'))
      }
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Phản hồi invoke và sự kiện webContents.send tới renderer qua hai đường độc lập.
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`agent IPC timed out for ${question}`)), 15_000)
      })
      const [result] = await Promise.all([Promise.race([terminal, deadline]), api.agent.prompt(pid, question, destination)])
      await Promise.all(actions)
      if (unexpectedDiff || approvals !== (decision ? 1 : 0) || result !== expected) {
        throw new Error(`agent IPC policy failed for ${question}: approvals=${approvals}, streamed=${streamed}, result=${result}`)
      }
    } finally {
      clearTimeout(timer)
      off()
    }
  }

  async function checkUnchanged(): Promise<void> {
    const current = await api.fs.read(pid, filename)
    if (current.text !== source || current.version !== original.version) {
      throw new Error('agent IPC modified the file before its diff was approved')
    }
  }

  try {
    await api.agent.setMode(pid, 'ask')
    await prompt('NEXGRAPH_SMOKE')
    await prompt('NEXGRAPH_SMOKE_ASK_WRITE')
    await prompt('NEXGRAPH_SMOKE_ASK_SHELL')

    await api.agent.setMode(pid, 'edit')
    await prompt('NEXGRAPH_SMOKE_EDIT_SHELL')
    for (const sentinel of ['smoke-read-should-not-write.txt', 'smoke-shell-should-not-run.txt']) {
      const [probe] = await Promise.allSettled([api.fs.read(pid, sentinel)])
      if (probe.status !== 'rejected' || probe.reason?.code !== 'file_not_found') {
        throw new Error(`agent IPC policy allowed a forbidden side effect: ${sentinel}`)
      }
    }

    await prompt('NEXGRAPH_SMOKE_EDIT_FILE', { decision: 'deny' })
    await checkUnchanged()
    await prompt('NEXGRAPH_SMOKE_EDIT_FILE', { decision: 'stop' })
    await checkUnchanged()
    await prompt('NEXGRAPH_SMOKE_EDIT_FILE', { decision: 'approve' })
    const revised = await api.fs.read(pid, filename)
    if (revised.text !== expectedEdit || revised.eol !== format.eol || !revised.bom) {
      throw new Error('agent IPC did not save exactly the approved diff and original format')
    }

    // GET /changes thường làm mới ảnh chụp hiện tại, giữ mốc của lần index đầy đủ trước đó.
    const changes = await api.graph.changes(pid)
    if (changes.base !== 'last_index' || changes.base_commit !== null || changes.changed_files.length !== 1 ||
      changes.changed_files[0].path !== filename || changes.changed_files[0].status !== 'M' ||
      !changes.changed_nodes.some((node) => node.id === helper.id) ||
      !changes.impacted.some((item) => item.node.id === external.id && item.hops === 1)) {
      throw new Error('no-Git Changes did not report the edited file and its cross-file caller')
    }
    const impact = await api.graph.impactOf(pid, helper.id)
    if (impact.node.id !== helper.id || !impact.impacted.some((item) => item.node.id === external.id && item.hops === 1)) {
      throw new Error('graph IPC did not propagate impact to the caller in the other file')
    }

    await api.agent.setMode(pid, 'ask')
    const offline = await selectProvider('smoke-offline', new URL('/offline/v1', baseUrl).href)
    await prompt('NEXGRAPH_SMOKE_PROVIDER_OUTAGE', { destination: offline, expected: 'error:ai_unreachable' })
    const afterOutage = await api.graph.search(pid, 'smokeExternal', { kinds: ['function'] })
    const updatedCode = await api.graph.code(pid, filename, 2, 2)
    if (!afterOutage.some(({ node }) => node.id === external.id) || updatedCode.text !== '  return false' || updatedCode.stale) {
      throw new Error('graph IPC could not read the published project after the provider outage')
    }
  } finally {
    await api.agent.close(pid)
  }
  return 'fs=OK agent=OK index=OK edit_policy=OK acceptance=OK'
}

/** Chạy trong UI đã nạp lại sau khi fixture được công bố bằng IPC thật. */
export async function runWorkspaceAcceptanceSmoke(projectName: string, expectWebglDisabled: boolean): Promise<string> {
  function waitFor<T extends Element>(find: () => T | undefined | null, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = find()
        if (!found) return
        clearTimeout(timer)
        observer.disconnect()
        resolve(found)
      }
      const observer = new MutationObserver(check)
      const timer = setTimeout(() => {
        observer.disconnect()
        reject(new Error(`workspace smoke did not find ${label}`))
      }, 7_000)
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
      check()
    })
  }

  function button(selector: string, label: string) {
    return waitFor(() => Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((item) =>
      !item.disabled && item.textContent?.trim().normalize('NFC').startsWith(label)), label)
  }

  function hit(button: HTMLButtonElement, label: string): HTMLButtonElement {
    const bounds = button.getBoundingClientRect()
    const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
    if (!bounds.width || !bounds.height || !target || !button.contains(target)) {
      throw new Error(`${label} is not reachable in the workspace at ${window.innerWidth}×${window.innerHeight}`)
    }
    return button
  }

  const recent = await waitFor(() => Array.from(document.querySelectorAll<HTMLButtonElement>('ul.recent button')).find((item) =>
    !item.disabled && item.querySelector('b')?.textContent?.normalize('NFC') === projectName.normalize('NFC')), projectName)
  recent.click()
  if (expectWebglDisabled) {
    const canvas = document.createElement('canvas')
    if (canvas.getContext('webgl2') || canvas.getContext('webgl')) throw new Error('WebGL is still enabled in the packaged renderer')
    const map = await button('.overview .cards button', 'Bản đồ')
    map.click()
    await waitFor(() => Array.from(document.querySelectorAll('.map-view [role="alert"]')).find((alert) =>
      alert.textContent?.includes('không bật được WebGL')), 'cảnh báo WebGL của Bản đồ')
    const architecture = await button('button[role="tab"]', 'Kiến trúc')
    architecture.click()
  } else {
    const architecture = await button('.overview .cards button', 'Kiến trúc')
    architecture.click()
  }
  await waitFor(() => document.querySelector('.arch-canvas .react-flow__node'), 'nút Kiến trúc')

  const projectPath = document.querySelector('.ws-head .mono')?.textContent?.normalize('NFC') ?? ''
  if (projectPath.length < 80 || !projectPath.includes('Đồ án')) throw new Error('workspace fixture path is not long enough')
  const changes = document.querySelector<HTMLButtonElement>('.activity-bar button[aria-label="Thay đổi"]')
  if (!changes) throw new Error('workspace smoke did not find the Changes toggle')
  hit(changes, 'Thay đổi').click()
  await waitFor(() => document.querySelector('.workspace .sidebar.wide'), 'bảng Thay đổi')
  const aiToggle = () => document.querySelector<HTMLButtonElement>('.ws-head button[aria-label="Ẩn/hiện trợ lý AI"]')
  const shown = (open: boolean) => {
    const toggle = aiToggle()
    return toggle?.getAttribute('aria-pressed') === String(open) ? toggle : null
  }
  const open = await waitFor(() => shown(false), 'nút mở trợ lý AI')
  hit(open, 'Mở trợ lý AI khi bảng Thay đổi đang mở').click()
  const dismiss = await waitFor(() => shown(true), 'nút đóng trợ lý AI')
  const exportButton = await button('.ws-head button', 'Xuất')
  hit(exportButton, 'Xuất khi Thay đổi và trợ lý AI đang mở')
  hit(dismiss, 'Đóng trợ lý AI khi bảng Thay đổi đang mở').click()
  await waitFor(() => shown(false), 'trạng thái trợ lý AI đã đóng')
  if (changes.getAttribute('aria-pressed') !== 'true') throw new Error('Changes unexpectedly closed while toggling AI')
  return `workspace_controls=OK${expectWebglDisabled ? ' webgl_fallback=OK' : ''}`
}
