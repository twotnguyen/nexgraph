/**
 * Python của engine/MCP server không được thừa hưởng `PYTHONPATH`/`PYTHONHOME` từ shell cha
 * (A4-F3): gói Python của dự án khác (hoặc phiên công cụ khác) lọt vào `sys.path` làm
 * `import pydantic_core` thất bại ngay khi server khởi động.
 *
 * Với cấu hình MCP do app sinh, hai biến được đặt rỗng (Python coi như không đặt) và
 * `PYTHONNOUSERSITE=1` tắt site-packages của người dùng để server chỉ dùng môi trường của engine.
 * Khi app tự spawn tiến trình, dùng `safeProcessEnv` (main/process-env.ts) — allowlist đã bỏ hai biến này.
 */
export const PYTHON_ENV_GUARD: Readonly<Record<string, string>> = {
  PYTHONPATH: '',
  PYTHONHOME: '',
  PYTHONNOUSERSITE: '1'
}
