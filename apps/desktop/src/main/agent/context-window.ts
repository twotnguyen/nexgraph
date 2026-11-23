/**
 * Ngưỡng cửa sổ ngữ cảnh tối thiểu để vừa system prompt + bộ công cụ của NexGraph.
 * Dưới ngưỡng này model không dùng được cho trợ lý: nói rõ số token thay vì khuyên "tăng context window"
 * (giá trị đó là mức thật của model, tăng lên sẽ bị nhà cung cấp từ chối).
 */
export const MIN_CONTEXT_WINDOW = 8_000

export const smallContextMessage = (window: number): string =>
  `Mô hình chỉ có ${window} token ngữ cảnh, không đủ cho system prompt + công cụ — chọn mô hình lớn hơn.`

export const contextTooSmall = (window?: number): window is number =>
  typeof window === 'number' && Number.isFinite(window) && window > 0 && window < MIN_CONTEXT_WINDOW
