export type EngineStatus =
  /** `attempt`: số thứ tự lần tự khởi động lại sau khi engine thoát (không có ở lần mở app).
   *  `message…`: lý do chết ngắn của lần trước, hiện kèm khi đang thử lại (review-50 M5). */
  | { state: 'starting'; attempt?: number; message?: string; messageKey?: string; messageVars?: Record<string, string | number> }
  | { state: 'ready'; engineVersion: string; vendorCommit: string }
  /** `restartable`: đã hết lượt tự thử lại, thanh trạng thái hiện nút "Khởi động lại engine". */
  | { state: 'error'; message: string; messageKey?: string; messageVars?: Record<string, string | number>; restartable?: boolean }
