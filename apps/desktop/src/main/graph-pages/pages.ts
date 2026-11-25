// NG-UI-1: tệp trang trong `<root>/.nexgraph/` + thư viện đóng gói + rebrand/CSP ở lớp phục vụ.
// Mọi hàm ở đây không phụ thuộc Electron để test được bằng Node; `protocol.ts` mới nối vào session.
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import type { GraphPagesStatus } from '@shared/graph-pages'

/** File Graphify ghi ra `<root>/.nexgraph/` (ADR 0024). */
export const PAGES_DIR = '.nexgraph'
export const GRAPH_FILE = 'graph.html'
export const TREE_FILE = 'GRAPH_TREE.html'
const CALLFLOW_SUFFIX = '-callflow.html'

/** Trang chỉ tải đúng 3 URL này; mọi thứ khác bị chặn (spike A3 §2). */
const LIB_URLS: Record<string, Record<string, string>> = {
  'unpkg.com': { '/vis-network@9.1.6/standalone/umd/vis-network.min.js': 'vis-network-9.1.6.min.js' },
  'cdn.jsdelivr.net': { '/npm/mermaid@11/dist/mermaid.min.js': 'mermaid-11.min.js' },
  'd3js.org': { '/d3.v7.min.js': 'd3.v7.min.js' }
}

/** sha384 của vis-network 9.1.6 trên unpkg — trùng chuỗi `integrity` trong graph.html; lệch là trang trắng. */
export const VIS_INTEGRITY = 'Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1'

// graph.html chứa <script> inline và onchange=… nên buộc phải cho 'unsafe-inline'; còn lại khoá hết.
export const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://d3js.org",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}
/** Chỉ phục vụ tệp tĩnh của trang; không mở đường đọc tệp tuỳ ý trong .nexgraph. */
const SERVED_EXT = new Set(Object.keys(MIME).concat('.map'))

/** Phần trạng thái dò được từ đĩa; main bổ sung `partition`/`preload` khi trả cho renderer. */
export type GraphPagesFiles = Omit<GraphPagesStatus, 'partition' | 'preload'>

export const graphPagesDir = (root: string): string => join(root, PAGES_DIR)

const isInside = (base: string, target: string): boolean => {
  const prefix = base.endsWith(sep) ? base : base + sep
  return target === base || target.startsWith(prefix)
}

/**
 * Thư mục `.nexgraph` THẬT của dự án, neo từ gốc: realpath(root) → realpath(root/.nexgraph)
 * phải nằm trong gốc. `.nexgraph` là symlink trỏ ra ngoài gốc → null (không đọc gì cả).
 * Mọi đường đọc (dò trang, phục vụ trang, chỉ mục graph.json) dùng chung hàm này.
 */
export async function resolvePagesDir(root: string): Promise<string | null> {
  try {
    const realRoot = await realpath(root)
    const dir = await realpath(join(realRoot, PAGES_DIR))
    return isInside(realRoot, dir) ? dir : null
  } catch {
    return null
  }
}

/** Trang nào đã có trong .nexgraph (chưa có → giao diện cũ, R-N3). */
export async function discoverGraphPages(root: string): Promise<GraphPagesFiles> {
  const dir = graphPagesDir(root)
  let names: string[] = []
  try {
    const realDir = await resolvePagesDir(root)
    if (!realDir) return { dir, graph: false, tree: false, callflow: null }
    names = await readdir(realDir)
  } catch {
    return { dir, graph: false, tree: false, callflow: null }
  }
  const callflow = names.filter((name) => name.endsWith(CALLFLOW_SUFFIX)).sort()[0] ?? null
  return { dir, graph: names.includes(GRAPH_FILE), tree: names.includes(TREE_FILE), callflow }
}

/**
 * Đường dẫn thật của một tệp trong .nexgraph. `name` là một đoạn đường dẫn duy nhất;
 * thư mục phải neo trong gốc dự án và tệp phải nằm trong thư mục đó (chặn cả symlink).
 */
export async function resolveGraphPage(root: string, name: string): Promise<string | null> {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || name === '.' || name === '..') return null
  if (!SERVED_EXT.has(extname(name).toLowerCase())) return null
  const dir = await resolvePagesDir(root)
  if (!dir) return null
  try {
    const realFile = await realpath(join(dir, name))
    if (!isInside(dir, realFile)) return null
    return (await stat(realFile)).isFile() ? realFile : null
  } catch {
    return null
  }
}

const SEGMENT = /(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/gi
/**
 * ADR 0025: đổi tên hiển thị ngay lúc phục vụ, không sửa tệp trong `.nexgraph/`.
 * Bỏ qua <script>/<style>: dữ liệu và mã trong đó có thể chứa "graphify" (id nút, tên cộng đồng).
 */
export function rebrandHtml(html: string): string {
  return html.split(SEGMENT).map((part) => {
    if (/^<(script|style)\b/i.test(part)) return part
    return part.replace(/graphify-out/gi, '.nexgraph').replace(/graphify/gi, 'NexGraph')
  }).join('')
}

/** Chromium bỏ header CSP trên scheme tự tạo → chèn <meta> ngay sau <head> (spike A3 §3.2). */
export function injectCsp(html: string, csp: string = PAGE_CSP): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">`
  return /<head(\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (m) => m + meta) : meta + html
}

/** Tên tệp thư viện cục bộ cho một URL CDN Graphify sinh ra, null nếu ngoài allowlist. */
export function localLibFor(url: string): string | null {
  try {
    const u = new URL(url)
    const host = LIB_URLS[u.hostname.toLowerCase()]
    return host?.[u.pathname] ?? null
  } catch {
    return null
  }
}

/** Lớp chặn cuối của partition: nxpage, devtools và đúng 3 URL thư viện. */
export function isAllowedRequest(url: string): boolean {
  return url.startsWith('nxpage://') || url.startsWith('devtools://') || localLibFor(url) !== null
}

export interface PageServeOptions {
  /** projectId → thư mục gốc dự án; chỉ dự án đã mở trong app mới phục vụ được. */
  roots: Map<string, string>
  libsDir: string
}

const text = (body: string, status: number, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers } })

const fileResponse = async (file: string, headers: Record<string, string>): Promise<Response> => {
  const body = await readFile(file)
  return new Response(body, { status: 200, headers: { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store', ...headers } })
}

/** `nxpage://<projectId>/<tên tệp>` — một đoạn duy nhất, chỉ trong `<root>/.nexgraph/`. */
export async function handlePageRequest(url: string, opts: PageServeOptions): Promise<Response> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return text('bad url', 400)
  }
  if (parsed.protocol !== 'nxpage:') return text('forbidden', 403)
  const root = opts.roots.get(parsed.hostname)
  if (!root) return text('unknown project', 403)
  let name: string
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  } catch {
    return text('bad path', 400)
  }
  if (!name || name.includes('/') || name.includes('\\') || name.split('/').includes('..')) return text('forbidden', 403)
  const file = await resolveGraphPage(root, name)
  if (!file) return text('not found', 404)
  if (extname(file).toLowerCase() === '.html') {
    const html = injectCsp(rebrandHtml(await readFile(file, 'utf8')))
    return new Response(html, { status: 200, headers: { 'content-type': MIME['.html'], 'cache-control': 'no-store', 'content-security-policy': PAGE_CSP } })
  }
  return fileResponse(file, {})
}

/** Mọi request https của partition: trả thư viện đóng gói hoặc 403. */
export async function handleWebRequest(url: string, opts: { libsDir: string }): Promise<Response> {
  const lib = localLibFor(url)
  if (!lib) return text('blocked by NexGraph offline policy', 403)
  try {
    return await fileResponse(join(opts.libsDir, lib), {
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'timing-allow-origin': '*'
    })
  } catch {
    return text('library missing', 500)
  }
}

/** Test khói sau mỗi lần nâng Graphify: 3 URL phải còn đúng byte (SRI của vis-network). */
export function libIntegrity(bytes: Buffer): string {
  return createHash('sha384').update(bytes).digest('base64')
}

/** `source_location` của graph.json dạng "L5" / "L5-L9" / "src/a.ts:L5" → dòng đầu. */
export function lineFromSourceLocation(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = value.match(/L(\d+)/) ?? value.match(/:(\d+)/)
  return match ? Number(match[1]) : null
}

export interface PageNodeLocation { file: string | null; line: number | null }

const indexCache = new Map<string, { mtimeMs: number; index: Map<string, PageNodeLocation> }>()

/**
 * Chỉ mục id → tệp:dòng đọc từ `<root>/.nexgraph/graph.json`. `graph.html` không xuất
 * `source_location` (spike A3 §6) và id của Graphify khác id graph.db của NexGraph, nên đây là
 * nguồn tra cứu cho nút chọn từ trang. Đọc lười, cache theo mtime của tệp.
 */
export async function readGraphJsonIndex(root: string): Promise<Map<string, PageNodeLocation>> {
  // Cùng phép kiểm containment với phục vụ trang: không đọc graph.json ngoài `<root>/.nexgraph/`.
  const file = await resolveGraphPage(root, 'graph.json')
  if (!file) return new Map()
  try {
    const info = await stat(file)
    const cached = indexCache.get(file)
    if (cached && cached.mtimeMs === info.mtimeMs) return cached.index
    const data = JSON.parse(await readFile(file, 'utf8')) as { nodes?: unknown }
    const index = new Map<string, PageNodeLocation>()
    for (const raw of Array.isArray(data.nodes) ? data.nodes : []) {
      if (!raw || typeof raw !== 'object') continue
      const node = raw as { id?: unknown; source_file?: unknown; source_location?: unknown }
      if (typeof node.id !== 'string') continue
      index.set(node.id, {
        file: typeof node.source_file === 'string' ? node.source_file : null,
        line: lineFromSourceLocation(node.source_location)
      })
    }
    indexCache.set(file, { mtimeMs: info.mtimeMs, index })
    return index
  } catch {
    return new Map()
  }
}

