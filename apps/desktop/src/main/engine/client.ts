import type { EngineHandle } from './launcher'

export interface Health {
  status: 'ok'
  api_version: '1'
  engine_version: string
  vendor_commit: string
}

type Target = Pick<EngineHandle, 'baseUrl' | 'token'>

async function getJson<T>(h: Target, path: string): Promise<T> {
  const res = await fetch(`${h.baseUrl}${path}`, { headers: { Authorization: `Bearer ${h.token}` } })
  if (!res.ok) throw new Error(`Engine trả về ${res.status} cho ${path}`)
  return (await res.json()) as T
}

export const getHealth = (h: Target): Promise<Health> => getJson<Health>(h, '/v1/health')
export const getSelftest = (h: Target): Promise<{ ok: boolean; nodes: number }> =>
  getJson(h, '/v1/selftest')
