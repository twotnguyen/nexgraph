export type EngineStatus =
  /** `attempt`: số thứ tự lần tự khởi động lại sau khi engine thoát (không có ở lần mở app). */
  | { state: 'starting'; attempt?: number }
  | { state: 'ready'; engineVersion: string; vendorCommit: string }
  /** `restartable`: đã hết lượt tự thử lại, thanh trạng thái hiện nút "Khởi động lại engine". */
  | { state: 'error'; message: string; messageKey?: string; messageVars?: Record<string, string | number>; restartable?: boolean }
