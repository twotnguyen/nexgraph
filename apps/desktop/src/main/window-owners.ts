/**
 * Chủ sở hữu theo cửa sổ của tài nguyên dùng chung (PR #49 vòng 2).
 *
 * Phiên agent của một dự án và các pty terminal do MỘT cửa sổ mở ra; trước đây mọi sự kiện đi
 * theo cửa sổ đang focus và reload/crash một cửa sổ dọn agent của mọi cửa sổ. Lớp này giữ
 * ánh xạ khoá → cửa sổ để main gửi sự kiện về đúng nơi và chỉ dọn tài nguyên của cửa sổ hỏng.
 *
 * - `claim`: cửa sổ đầu tiên mở phiên là chủ; cửa sổ khác không giành mất phiên đang sống.
 * - `assign`: lượt mới (prompt) chuyển chủ, để sự kiện của lượt đó về đúng cửa sổ đã gửi.
 * - `release`: bỏ mọi khoá của một cửa sổ khi cửa sổ reload/crash/đóng.
 */
export class WindowOwners<Owner> {
  private readonly owners = new Map<string, Owner>()

  /** Gán chủ nếu khoá chưa có chủ; giữ nguyên chủ cũ khi phiên đang sống. */
  claim(key: string, owner: Owner): void {
    if (!this.owners.has(key)) this.owners.set(key, owner)
  }

  /** Chuyển chủ (lượt agent mới do cửa sổ khác gửi). */
  assign(key: string, owner: Owner): void {
    this.owners.set(key, owner)
  }

  ownerOf(key: string): Owner | undefined {
    return this.owners.get(key)
  }

  /** Bỏ và trả các khoá thuộc `owner`; khoá của cửa sổ khác giữ nguyên. */
  release(owner: Owner): string[] {
    const keys: string[] = []
    for (const [key, held] of this.owners) {
      if (held !== owner) continue
      this.owners.delete(key)
      keys.push(key)
    }
    return keys
  }

  get size(): number {
    return this.owners.size
  }
}
