import { join } from 'node:path'
import type { EngineCommand } from '../../engine/launcher'
import type { PiSession, SessionSpec } from '../session'
import { NexClient } from './client'
import { nexConfig, nexProjectKey, nexProviderEnv, type NexProvider } from './config'
import { NexSession } from './session'
import { NexSidecar, resolveNexBinary } from './sidecar'

/** Env bổ sung của test/QA: bỏ giá trị undefined để khớp Record<string, string>. */
const extraEnv = (source: NodeJS.ProcessEnv = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))

const coded = (code: string, message: string): Error => Object.assign(new Error(message), { name: 'AgentError', code })

export type NexRuntimeOptions = {
  /** `<userData>` của app; Nex dùng `<userData>/nex/<dự án>`. */
  dataDir: string
  isPackaged: boolean
  resourcesPath: string
  engineCommand: () => EngineCommand
  getProvider: () => Promise<NexProvider | null>
  env?: NodeJS.ProcessEnv
  /** Cho test/QA: bỏ qua tìm binary. */
  binPath?: string | null
  /** Cho test/QA: hạn chờ sidecar báo ready (mặc định 30 s). */
  startupTimeoutMs?: number
  log?: (line: string) => void
}

/** Binary Nex nếu máy có; dùng cho cài đặt runtime (Nex mặc định khi tìm thấy). */
export function nexAvailable(o: { isPackaged: boolean; resourcesPath: string; env?: NodeJS.ProcessEnv }): boolean {
  return resolveNexBinary({ env: o.env ?? process.env, isPackaged: o.isPackaged, resourcesPath: o.resourcesPath }) !== null
}

/** Một tiến trình Nex cho mỗi dự án; phiên đóng thì tiến trình dừng theo. */
export async function createNexSession(spec: SessionSpec, o: NexRuntimeOptions): Promise<PiSession> {
  const provider = await o.getProvider()
  if (!provider) {
    throw coded('ai_not_configured', 'Nex chỉ hỗ trợ nhà cung cấp OpenAI-compatible có API key. Hãy thêm nhà cung cấp trong Cài đặt hoặc chuyển runtime sang Pi.')
  }
  const bin = o.binPath === null ? null : o.binPath ?? resolveNexBinary({
    env: o.env ?? process.env, isPackaged: o.isPackaged, resourcesPath: o.resourcesPath
  })
  if (!bin) throw coded('ai_not_configured', 'Chưa tìm thấy runtime Nex trên máy này. Hãy chọn runtime Pi trong Cài đặt.')
  const root = spec.cwd
  const sidecar = new NexSidecar({
    bin,
    dataDir: join(o.dataDir, 'nex'),
    projectKey: nexProjectKey(spec.projectId ?? root),
    cwd: root,
    config: () => nexConfig({ root, engine: o.engineCommand(), dataDir: o.dataDir, provider }),
    env: { ...nexProviderEnv(provider), ...extraEnv(o.env) },
    envSource: process.env,
    startupTimeoutMs: o.startupTimeoutMs,
    log: o.log
  })
  try {
    await sidecar.start()
    // Getter, không chép URL/mật khẩu: sidecar khởi động lại thì client + SSE dùng cổng/mật khẩu mới.
    const client = new NexClient({ baseUrl: () => sidecar.url, secret: () => sidecar.secret })
    return new NexSession({
      root, client, model: { provider: spec.model.provider, id: spec.model.id },
      gate: spec.gate, isEdit: () => (spec.getMode?.() ?? 'edit') === 'edit',
      stopSidecar: () => sidecar.stop(),
      watchSidecar: (listener) => sidecar.onUnexpectedExit(listener),
      onProviderFailure: spec.onProviderFailure
    }) as unknown as PiSession
  } catch (error) {
    // Không để tiến trình mồ côi khi dựng client/phiên hỏng sau khi sidecar đã lên.
    await sidecar.stop().catch(() => {})
    throw error
  }
}
