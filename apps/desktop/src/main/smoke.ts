import { getHealth, getSelftest } from './engine/client'
import type { EngineHandle } from './engine/launcher'

/** Kiểm tra nhanh bản đóng gói: engine trả health ok và selftest chạy được bộ trích xuất đa ngôn ngữ. */
export async function runSmoke(h: Pick<EngineHandle, 'baseUrl' | 'token'>): Promise<string> {
  const health = await getHealth(h)
  if (health.status !== 'ok') throw new Error('health failed')
  const self = await getSelftest(h)
  if (!self.ok) throw new Error('selftest failed')
  return `SMOKE OK nodes=${self.nodes}`
}
