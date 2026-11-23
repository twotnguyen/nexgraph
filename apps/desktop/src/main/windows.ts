/**
 * Tập cửa sổ NexGraph đang mở (PR #49: menu File → Cửa sổ mới).
 *
 * Trước đây main giữ một biến `mainWindow`; mở cửa sổ thứ hai ghi đè biến đó nên đóng cửa sổ
 * đầu là mất tham chiếu cửa sổ còn sống, còn đóng một cửa sổ lại dọn agent của tất cả. Lớp này
 * giữ "cửa sổ chính" là cửa sổ còn sống đầu tiên và báo khi cửa sổ cuối đóng.
 */
export type WindowLike = { isDestroyed(): boolean }

export class WindowSet<T extends WindowLike> {
  private windows = new Set<T>()
  private primary: T | null = null

  add(win: T): void {
    this.windows.add(win)
    if (!this.primary || this.primary.isDestroyed()) this.primary = win
  }

  /** Gỡ cửa sổ đã đóng; `empty` = không còn cửa sổ nào (lúc đó mới dọn agent/engine). */
  remove(win: T): { empty: boolean } {
    this.windows.delete(win)
    if (this.primary === win) this.primary = this.first()
    return { empty: this.windows.size === 0 }
  }

  get size(): number { return this.windows.size }

  /** Cửa sổ chính để mở hộp thoại/gửi sự kiện khi không có cửa sổ nào đang focus. */
  main(): T | null {
    return this.primary && !this.primary.isDestroyed() ? this.primary : this.first()
  }

  all(): T[] {
    return [...this.windows].filter((win) => !win.isDestroyed())
  }

  private first(): T | null {
    for (const win of this.windows) if (!win.isDestroyed()) return win
    return null
  }
}
