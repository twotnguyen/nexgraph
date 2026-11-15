import type { NexGraphApi } from '../shared/api'

/** Chạy nguyên hàm trong renderer của bản cài để kiểm cả contextBridge và IPC. */
export async function runRendererSmoke(api: NexGraphApi, root: string, baseUrl: string): Promise<string> {
  const project = await api.project.open(root)
  await api.fs.write(project.project_id, 'smoke.ts', 'export const smoke = true\n', { eol: '\r\n', bom: true })
  const file = await api.fs.read(project.project_id, 'smoke.ts')
  if (file.text !== 'export const smoke = true\n' || file.eol !== '\r\n' || !file.bom || file.readOnly) {
    throw new Error('fs IPC roundtrip failed')
  }
  await api.auth.saveCustom({ id: 'smoke', label: 'Smoke local', baseUrl, model: 'fake' })
  await api.auth.selectModel('smoke', 'fake')
  await api.ai.grantConsent(project.project_id)
  let result = ''
  const off = api.agent.onEvent((pid, event) => {
    if (pid !== project.project_id) return
    if (event.type === 'done') result = event.text
    if (event.type === 'error') result = `ERROR: ${event.code}`
  })
  try {
    await api.agent.prompt(project.project_id, 'NEXGRAPH_SMOKE')
    if (result !== 'NEXGRAPH_SMOKE_OK') throw new Error(`agent IPC failed: ${result}`)
  } finally {
    off()
    await api.agent.close(project.project_id)
  }
  return 'fs=OK agent=OK'
}
