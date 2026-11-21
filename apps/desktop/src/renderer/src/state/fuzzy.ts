export interface FuzzyMatch {
  score: number
  /** Chỉ số ký tự (theo Array.from) khớp, để tô đậm. */
  positions: number[]
}

// Bỏ dấu tiếng Việt từng ký tự (giữ độ dài) để "cai dat" khớp "Cài đặt".
const fold = (ch: string): string => (ch === 'đ' || ch === 'Đ' ? 'd' : ch.normalize('NFD')[0].toLowerCase())
const BOUNDARY = /[\s/\\_\-.:()]/

/**
 * Khớp mờ kiểu dãy con: mọi ký tự truy vấn (bỏ khoảng trắng) phải xuất hiện theo thứ tự.
 * Điểm cộng khi khớp liền nhau, ở đầu từ hoặc đầu chuỗi; trừ nhẹ theo độ dài chuỗi.
 * Chọn vị trí: liền ký tự trước nếu được, không thì đầu từ gần nhất mà phần còn lại vẫn khớp, không thì vị trí đầu tiên.
 * shortcut: không tìm cách khớp tối ưu toàn cục; đủ cho danh sách lệnh/tệp vài nghìn mục.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = Array.from(query).filter((ch) => !/\s/.test(ch)).map(fold)
  if (needle.length === 0) return { score: 0, positions: [] }
  const chars = Array.from(text)
  const hay = chars.map(fold)
  const boundary = (at: number) => at === 0 || BOUNDARY.test(chars[at - 1]) || (chars[at] !== chars[at].toLowerCase() && chars[at - 1] === chars[at - 1].toLowerCase())
  const restFits = (rest: number, from: number) => {
    for (let i = rest; i < needle.length; i++) {
      from = hay.indexOf(needle[i], from) + 1
      if (from === 0) return false
    }
    return true
  }
  const positions: number[] = []
  let score = 0
  let from = 0
  for (const [i, ch] of needle.entries()) {
    const first = hay.indexOf(ch, from)
    if (first < 0) return null
    const prev = positions.at(-1)
    let at = first
    if (prev === undefined || first !== prev + 1) {
      for (let j = first; j >= 0; j = hay.indexOf(ch, j + 1)) {
        if (boundary(j) && restFits(i + 1, j + 1)) { at = j; break }
      }
    }
    score += 1
    if (prev !== undefined && at === prev + 1) score += 4
    if (boundary(at)) score += 3
    positions.push(at)
    from = at + 1
  }
  return { score: score - positions[0] * 0.05 - chars.length * 0.01, positions }
}

/** Lọc và xếp theo điểm giảm dần; truy vấn rỗng giữ nguyên thứ tự. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): { item: T; positions: number[] }[] {
  if (!query.trim()) return items.map((item) => ({ item, positions: [] }))
  const out: { item: T; positions: number[]; score: number }[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, text(item))
    if (match) out.push({ item, ...match })
  }
  return out.sort((a, b) => b.score - a.score)
}
