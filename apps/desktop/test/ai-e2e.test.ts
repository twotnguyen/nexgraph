// Kiểm đầu-cuối phiên agent (pi thật) với engine Python thật + LLM giả. Chạy: NEXGRAPH_E2E=1 pnpm --filter @nexgraph/desktop test ai-e2e
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AgentService } from '../src/main/agent/session'
import { settingsModels } from '../src/main/agent/model'
import type { AgentEvent } from '../src/shared/agent-types'
import { AiSettingsStore } from '../src/main/ai/settings'
import { EngineApi } from '../src/main/engine/api'
import { startEngine, type EngineHandle } from '../src/main/engine/launcher'
// @ts-expect-error mjs không có kiểu
import { createFakeLlm } from '../scripts/fake-llm.mjs'

const run = process.env.NEXGRAPH_E2E ? describe : describe.skip
const repo = resolve(__dirname, '../../..')

run('AI end-to-end (engine thật + LLM giả)', () => {
  let h: EngineHandle
  let llm: ReturnType<typeof createFakeLlm>
  let pid: string
  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'ng-e2e-'))
    cpSync(join(repo, 'engine/tests/fixtures/flow_app'), join(root, 'proj'), { recursive: true })
    h = await startEngine({ command: 'uv', args: ['run', '--project', join(repo, 'engine'), 'nexgraph-engine'] }, { dataDir: join(root, 'data'), env: process.env })
    const api = new EngineApi(h)
    pid = (await api.openProject(join(root, 'proj'))).project_id
    const { job_id } = await api.startIndex(pid)
    for (;;) {
      const job = await (await fetch(`${h.baseUrl}/v1/jobs/${job_id}`, { headers: { Authorization: `Bearer ${h.token}` } })).json() as { state: string }
      if (['done', 'error', 'cancelled'].includes(job.state)) break
      await new Promise((r) => setTimeout(r, 100))
    }
    llm = createFakeLlm()
    await new Promise<void>((r) => llm.listen(0, '127.0.0.1', r))
  }, 120_000)
  afterAll(async () => { llm?.close(); await h?.stop() })

  it('hỏi luồng đăng nhập: gọi list_flows, trace_flow; trích dẫn thật hợp lệ, trích dẫn bịa bị đánh dấu', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ng-e2e-s-'))
    const settings = new AiSettingsStore(join(dir, 'p.json'), join(dir, 'k.json'), { available: () => true, encrypt: (s) => s, decrypt: (s) => s })
    settings.save({ baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: 'fake' })
    settings.grantConsent(pid)
    const events: AgentEvent[] = []
    const svc = new AgentService({ api: new EngineApi(h), dataDir: dir, models: settingsModels(dir, settings), hasConsent: (p) => settings.hasConsent(p),
      rootOf: async () => (await new EngineApi(h).listProjects()).find((p) => p.project_id === pid)!.path, emit: (_p, e) => events.push(e) })
    await svc.prompt(pid, 'luồng đăng nhập chạy thế nào?')
    svc.closeAll()
    expect(events.filter((e) => e.type === 'tool' && e.status === 'start').map((e) => (e as { name: string }).name)).toEqual(['list_flows', 'trace_flow'])
    const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>
    expect(done.type).toBe('done')
    const valid = done.citations.filter((c) => c.valid)
    expect(valid.length).toBeGreaterThanOrEqual(3)
    expect(done.citations.find((c) => c.file === 'khong-co.ts')).toMatchObject({ valid: false, reason: 'file_not_found' })
    expect(valid[0].file).toBe('app.py')
  }, 60_000)
})
