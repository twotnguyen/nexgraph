import type { AccountDevHooks } from '../features/agent/accounts'

/**
 * Hook kiểm thử của luồng tài khoản AI. Chỉ nối khi app chạy từ mã nguồn: bản đóng gói luôn trả
 * `undefined` để cờ môi trường không thể đổi hành vi sản phẩm (bản cài không đọc `process.env` cho
 * các nhánh lỗi giả lập).
 */
export function accountDevHooks(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): AccountDevHooks | undefined {
  if (isPackaged) return undefined
  return env.NEXGRAPH_DEV_FAIL_RESTORE_KEY === '1' ? { failRestoreKey: true } : undefined
}
