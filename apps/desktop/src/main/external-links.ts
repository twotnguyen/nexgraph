/** Chỉ liên kết web được mở trong trình duyệt bên ngoài. */
export function externalWebUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function isSameDocument(current: string, target: string): boolean {
  try {
    const before = new URL(current)
    const after = new URL(target)
    return before.protocol === after.protocol && before.host === after.host && before.pathname === after.pathname && before.search === after.search
  } catch { return false }
}

// CI-1 probe desktop: comment thử để đo CI chọn lọc; nhánh thử sẽ bị xoá.

