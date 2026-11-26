import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import type { AgentId, IntegrationOptions } from '../../../shared/integration-types'
import { writeJson } from '../../platform/settings'
import { EngineApiError } from '../../platform/engine/api'
import { gitBranch, hookPreview, hookStatus, installHook, uninstallHook } from './git-hook'
import { applyPlatform, applyUninstall, planPlatform, planUninstall } from './integrations'
import { McpHttpManager, mcpStdioConfig, type McpKeyStore, type McpPortStore } from './mcp-http'
import type { IpcContext } from '../../platform/ipc-context'
import { prefsFile, readJson } from '../../platform/prefs'

let mcpHttp: McpHttpManager | null = null

/** Dừng mọi máy chủ MCP HTTP khi thoát app. */
export const stopAllMcpHttp = (): Promise<void> => mcpHttp?.stopAll() ?? Promise.resolve()

/** Cổng MCP HTTP lần trước theo project (không bí mật) trong prefs.json. */
const prefsPortStore = (): McpPortStore => ({
  load: (pid) => Number(readJson(prefsFile())[`mcpPort:${pid}`]) || null,
  save: (pid, port) => writeJson(prefsFile(), { ...readJson(prefsFile()), [`mcpPort:${pid}`]: String(port) })
})

/** Key MCP HTTP theo project, mã hoá bằng safeStorage trong userData/mcp-keys.json. */
function safeKeyStore(): McpKeyStore {
  const file = (): string => join(app.getPath('userData'), 'mcp-keys.json')
  return {
    load(pid) {
      const enc = readJson(file())[pid]
      if (!enc || !safeStorage.isEncryptionAvailable()) return null
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'))
      } catch {
        return null
      }
    },
    save(pid, key) {
      if (!safeStorage.isEncryptionAvailable()) return // không lưu key dạng rõ; lần sau sinh key mới
      const all = readJson(file())
      all[pid] = safeStorage.encryptString(key).toString('base64')
      writeJson(file(), all)
    }
  }
}

/** Tích hợp trợ lý AI ngoài (W5): cấu hình MCP, git hook tự cập nhật (W4), MCP HTTP. */
export function registerIntegrationsIpc(ctx: IpcContext): void {
  const { on, rootOf, getCommand, dataDir } = ctx
  mcpHttp = new McpHttpManager(getCommand, dataDir, safeKeyStore(), prefsPortStore())
  const mcp = mcpHttp
  const removalVersions = new Map<string, symbol>()
  ctx.onProjectRemove((pid) => {
    removalVersions.set(pid, Symbol())
    return mcp.stop(pid)
  })
  // Mọi path đi vào engine/git hook/MCP đều suy từ projectId đã đăng ký, không tin path renderer gửi.
  on('mcp:config', async (pid: string) => ({ stdio: mcpStdioConfig(getCommand(), await rootOf(pid), dataDir) }))
  on('hook:status', async (pid: string) => hookStatus(await rootOf(pid), getCommand(), dataDir))
  on('hook:preview', async (pid: string) => hookPreview(await rootOf(pid), getCommand(), dataDir))
  on('hook:install', async (pid: string) => installHook(await rootOf(pid), getCommand(), dataDir))
  on('hook:uninstall', async (pid: string) => uninstallHook(await rootOf(pid)))
  on('hook:branch', async (pid: string) => gitBranch(await rootOf(pid)))
  on('mcp:plan', async (agent: AgentId, pid: string, opts?: IntegrationOptions) => planPlatform(agent, await rootOf(pid), getCommand(), dataDir, opts))
  on('mcp:apply', async (agent: AgentId, pid: string, opts?: IntegrationOptions) => applyPlatform(agent, await rootOf(pid), getCommand(), dataDir, opts))
  on('mcp:plan-remove', async (agent: AgentId, pid: string) => planUninstall(agent, await rootOf(pid), getCommand(), dataDir))
  on('mcp:remove', async (agent: AgentId, pid: string) => applyUninstall(agent, await rootOf(pid), getCommand(), dataDir))
  on('mcp:start-http', async (pid: string) => {
    const version = removalVersions.get(pid)
    const root = await rootOf(pid)
    if (removalVersions.get(pid) !== version) throw new EngineApiError(404, 'unknown_project', 'Đăng ký dự án đã thay đổi.')
    return mcp.start(pid, root)
  })
  on('mcp:stop-http', (pid: string) => mcp.stop(pid))
  on('mcp:http-status', async (pid: string) => mcp.status(pid))
}
