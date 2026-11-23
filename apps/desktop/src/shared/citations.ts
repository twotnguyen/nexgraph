/**
 * Nhận dạng trích dẫn nguồn trong câu trả lời của trợ lý AI.
 *
 * Hai dạng được chấp nhận:
 * - Có ngoặc: `[[lib/a.dart:10–42]]` — dạng chuẩn mà NEXGRAPH_RULES dạy model.
 * - Không ngoặc: `lib/a.dart:10–42` — model thật hay viết tắt như vậy; chỉ nhận khi
 *   đường dẫn không có khoảng trắng và tên tệp có phần mở rộng, để không nuốt chữ của câu
 *   (“Theo engine/run.py:96-98 thì…” phải ra `engine/run.py`, không phải `Theo engine/run.py`).
 *
 * Module dùng chung cho main (verify + theo dõi nút Tô luồng) và renderer (vẽ chip), nên
 * regex chỉ được định nghĩa ở đây.
 */
export interface ParsedCitation {
  raw: string
  file: string
  start: number
  end: number
}

/** Một lần xuất hiện trong văn bản, kèm vị trí để renderer đặt chip đúng chỗ. */
export interface ScannedCitation extends ParsedCitation {
  index: number
}

/** Ký tự hợp lệ trong đường dẫn không ngoặc; cố ý hẹp để không bắt dấu câu của câu văn. */
const BARE_PATH = '[A-Za-z0-9_./\\\\~#%@+&=-]'

const BRACKETED = String.raw`\[\[\s*([^\[\]\n]+?)\s*[:：]\s*(\d{1,7})(?:\s*[-–—]\s*(\d{1,7}))?\s*\]\]`
// Dấu cách được phép trong đường dẫn không ngoặc (thư mục/tệp có dấu cách); verifyCitations
// bỏ dần từ đầu khi engine báo không có tệp, nên chữ của câu đứng trước không bị coi là đường dẫn.
const BARE = String.raw`(?<![\w./\\:\]-])(` + BARE_PATH + String.raw`+(?: ` + BARE_PATH + String.raw`+)*)[:：](\d{1,7})(?:[-–—](\d{1,7}))?(?![\d\w])`

/** Nguồn regex chung; renderer dùng để tách text node thành chip. */
export const CITATION_SOURCE = `(?:${BRACKETED}|${BARE})`

const EXTENSION = /\.[A-Za-z][A-Za-z0-9_]{0,7}$/
const TLD = /\.(com|org|net|edu|gov|io|dev|app|co|vn|info|biz|me)$/i
const EXTENSIONLESS = /^(Makefile|Dockerfile|Jenkinsfile|LICENSE|README|Rakefile|Gemfile|Procfile)$/

/**
 * Tiền tố Markdown không thuộc trích dẫn: gạch đầu dòng, số thứ tự, tiêu đề. Markdown bỏ chúng
 * trước khi renderer thấy text node, nên `raw` phải bỏ luôn — nếu không chip không khớp và panel
 * đếm “đã xác minh” mà không có chip nào.
 */
const MARKDOWN_PREFIX = /^(?:#{1,6}[ \t]+|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/
/** Ký tự không thể bắt đầu một đường dẫn tương đối (dấu câu, gạch đầu dòng dính liền). */
const JUNK_PREFIX = /^[^A-Za-z0-9_.\\/]+/

const baseName = (file: string): string => file.split(/[\\/]/).at(-1) ?? file

/** Tệp trông có thật: có phần mở rộng, hoặc tên tệp quen thuộc không mở rộng. */
function looksLikeFile(file: string): boolean {
  const base = baseName(file)
  return EXTENSION.test(base) || EXTENSIONLESS.test(base)
}

/**
 * `bare` (không ngoặc) phải là tệp trông có thật; loại `example.com:8080` (TLD, không có `/`).
 */
function accept(file: string, bare: boolean): boolean {
  if (!file || /^[.\\/]+$/.test(file)) return false
  if (!bare) return looksLikeFile(file) || file.includes('/')
  if (!looksLikeFile(file)) return false
  return file.includes('/') || !TLD.test(file)
}

function scan(re: RegExp, text: string, bare: boolean): ScannedCitation[] {
  const out: ScannedCitation[] = []
  for (const m of text.matchAll(re)) {
    let file = bare ? m[1] : m[1].trim()
    let skip = 0
    if (bare) {
      const markdown = file.match(MARKDOWN_PREFIX)?.[0] ?? ''
      const junk = file.slice(markdown.length).match(JUNK_PREFIX)?.[0] ?? ''
      skip = markdown.length + junk.length
      file = file.slice(skip).trim()
    }
    const start = Number(m[2])
    if (!accept(file, bare)) continue
    out.push({ raw: m[0].slice(skip), file, start, end: m[3] ? Number(m[3]) : start, index: (m.index ?? 0) + skip })
  }
  return out
}

/** Mọi lần xuất hiện (kể cả trùng) theo thứ tự trong văn bản; renderer cần từng vị trí để đặt chip. */
export function scanCitations(text: string): ScannedCitation[] {
  const bracketed = scan(new RegExp(BRACKETED, 'g'), text, false)
  const taken = bracketed.map((c) => [c.index, c.index + c.raw.length] as const)
  // Trích dẫn trong ngoặc đã bắt trọn `[[a.ts:1-2]]`; bản không ngoặc lồng bên trong là trùng, bỏ.
  const bare = scan(new RegExp(BARE, 'g'), text, true)
    .filter((c) => !taken.some(([from, to]) => c.index >= from && c.index < to))
  return [...bracketed, ...bare].sort((a, b) => a.index - b.index)
}

export function parseCitations(text: string): ParsedCitation[] {
  const seen = new Set<string>()
  const out: ParsedCitation[] = []
  for (const { index: _index, ...citation } of scanCitations(text)) {
    if (seen.has(citation.raw)) continue
    seen.add(citation.raw)
    out.push(citation)
  }
  return out
}
