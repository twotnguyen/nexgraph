/** Câu lỗi để hiển thị: lỗi IPC qua contextBridge là object có `message` nhưng không `instanceof Error` ở renderer. */
export const errorText = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))
