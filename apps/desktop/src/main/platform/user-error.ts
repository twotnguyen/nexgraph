/** Lỗi có câu thông báo cho người dùng: đi qua IPC nguyên `code` và `message` (lỗi khác chỉ hiện thông báo chung). */
export class UserError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'UserError'
  }
}
