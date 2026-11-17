import type { NexGraphApi } from '../shared/api'

/** Chạy nguyên hàm trong renderer của bản cài để kiểm cả contextBridge và IPC. */
export async function runRendererSmoke(api: NexGraphApi, root: string, baseUrl: string): Promise<string> {
  const project = await api.project.open(root)
  const pid = project.project_id
  const filename = 'smoke.ts'
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

  await api.auth.saveCustom({ id: 'smoke', label: 'Smoke local', baseUrl, model: 'fake' })
  await api.auth.selectModel('smoke', 'fake')
  const settings = await api.ai.getSettings()
  if (settings.provider !== 'smoke' || !settings.baseUrl) throw new Error('agent IPC did not expose the selected smoke provider')
  const target = { provider: settings.provider, baseUrl: settings.baseUrl }
  await api.ai.grantConsent(pid, target)
  let result = ''
  const off = api.agent.onEvent((eventPid, event) => {
    if (eventPid !== pid) return
    if (event.type === 'done') result = event.text
    if (event.type === 'error') result = `ERROR: ${event.code}`
  })
  try {
    await api.agent.prompt(pid, 'NEXGRAPH_SMOKE', target)
    if (result !== 'NEXGRAPH_SMOKE_OK') throw new Error(`agent IPC failed: ${result}`)
  } finally {
    off()
    await api.agent.close(pid)
  }
  return 'fs=OK agent=OK index=OK'
}
