import { join } from 'node:path'
import type { EngineCommand } from '../../../platform/engine/launcher'
import type { PiSession, SessionSpec } from '../session'
import { NexClient } from './client'
import { nexAccountConfig, nexConfig, nexProjectKey, nexProviderEnv, type NexProvider } from './config'
import { NexSession } from './session'
import { NexSidecar, resolveNexBinary } from './sidecar'

/** Env bổ sung của test/QA: bỏ giá trị undefined để khớp Record<string, string>. */
const extraEnv = (source: NodeJS.ProcessEnv = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))

const coded = (code: string, message: string): Error => Object.assign(new Error(message), { name: 'AgentError', code })

export type NexRuntimeOptions = {
  /** `<userData>` của app; Nex dùng `<userData>/nex`. */
  dataDir: string
  isPackaged: boolean
  resourcesPath: string
  engineCommand: () => EngineCommand
  getProvider: () => Promise<NexProvider | null>
  /** Model mặc định đã chọn trong khối tài khoản Nex; null thì dùng nhà cung cấp của app. */
  getAccountModel?: () => Promise<{ provider: string; id: string } | null>
  /** Gốc dữ liệu Nex (mặc định `<dataDir>/nex`); tài khoản/token nằm trong `<userData>/nex`. */
  nexDataDir?: string
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
  const account = await o.getAccountModel?.() ?? null
  const provider = account ? null : await o.getProvider()
  if (!account && !provider) {
    throw coded('ai_not_configured', 'Nex chưa có tài khoản AI. Hãy đăng nhập hoặc thêm nhà cung cấp trong Cài đặt, hoặc chuyển runtime sang Pi.')
  }
  const bin = o.binPath === null ? null : o.binPath ?? resolveNexBinary({
    env: o.env ?? process.env, isPackaged: o.isPackaged, resourcesPath: o.resourcesPath
  })
  if (!bin) throw coded('ai_not_configured', 'Chưa tìm thấy runtime Nex trên máy này. Hãy chọn runtime Pi trong Cài đặt.')
  const root = spec.cwd
  const dataRoot = o.nexDataDir ?? join(o.dataDir, 'nex')
  const projectKey = nexProjectKey(spec.projectId ?? root)
  const sidecar = new NexSidecar({
    bin,
    dataDir: dataRoot,
    projectKey,
    // HOME dùng chung để đăng nhập một lần dùng được cho mọi dự án; cấu hình (MCP, quyền) theo dự án.
    homeDir: join(dataRoot, 'home'),
    configDir: join(dataRoot, 'projects', projectKey, 'config'),
    cwd: root,
    config: () => account
      ? nexAccountConfig({ root, engine: o.engineCommand(), dataDir: o.dataDir, providerID: account.provider, model: account.id })
      : nexConfig({ root, engine: o.engineCommand(), dataDir: o.dataDir, provider: provider! }),
    env: { ...(provider ? nexProviderEnv(provider) : {}), ...extraEnv(o.env) },
    envSource: process.env,
    startupTimeoutMs: o.startupTimeoutMs,
    log: o.log
  })
  try {
    await sidecar.start()
    // Getter, không chép URL/mật khẩu: sidecar khởi động lại thì client + SSE dùng cổng/mật khẩu mới.
    const client = new NexClient({ baseUrl: () => sidecar.url, secret: () => sidecar.secret })
    return new NexSession({
      root, client,
      model: account ? { provider: account.provider, id: account.id } : { provider: spec.model.provider, id: spec.model.id },
      ...(account ? { providerId: account.provider } : {}),
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
