/**
 * Python của engine/MCP server không được thừa hưởng `PYTHONPATH`/`PYTHONHOME` từ shell cha
 * (A4-F3): gói Python của dự án khác (hoặc phiên công cụ khác) lọt vào `sys.path` làm
 * `import pydantic_core` thất bại ngay khi server khởi động.
 *
 * Với cấu hình MCP do app sinh, hai biến được đặt rỗng (Python coi như không đặt) và
 * `PYTHONNOUSERSITE=1` tắt site-packages của người dùng để server chỉ dùng môi trường của engine.
 */
export const PYTHON_ENV_GUARD: Readonly<Record<string, string>> = {
  PYTHONPATH: '',
  PYTHONHOME: '',
  PYTHONNOUSERSITE: '1'
}

/** Bản env để tự spawn tiến trình Python: bỏ hẳn hai biến và tắt site của người dùng. */
export function pythonSafeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env }
  delete clean.PYTHONPATH
  delete clean.PYTHONHOME
  return { ...clean, PYTHONNOUSERSITE: '1' }
}
