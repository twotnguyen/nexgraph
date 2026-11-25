// NG-UI-1: tệp trang trong `<root>/.nexgraph/` + thư viện đóng gói + rebrand/CSP ở lớp phục vụ.
// Mọi hàm ở đây không phụ thuộc Electron để test được bằng Node; `protocol.ts` mới nối vào session.
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import type { GraphPagesStatus } from '@shared/graph-pages'
import { COMMUNITY_PAGE_FILE } from '@shared/graph-pages'

export { COMMUNITY_PAGE_FILE }

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
  // NG-ACT-2: trang cộng đồng sinh từ graph.json, không có tệp trên đĩa.
  if (name === COMMUNITY_PAGE_FILE) {
    const raw = parsed.searchParams.get('c')
    const community = raw !== null && /^\d{1,9}$/.test(raw) ? Number(raw) : null
    if (community === null) return text('bad community', 400)
    const graph = await readGraphJsonCommunity(root, community)
    if (!graph) return text('community not found', 404)
    const html = injectCsp(rebrandHtml(renderCommunityPage(graph)))
    return new Response(html, { status: 200, headers: { 'content-type': MIME['.html'], 'cache-control': 'no-store', 'content-security-policy': PAGE_CSP } })
  }
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

// ---------------------------------------------------------------------------
// NG-ACT-2: trang cộng đồng — đọc/lọc `graph.json` ở main rồi sinh HTML cùng ngôn ngữ
// hình ảnh với `graph.html` (vis-network 9.1.6 đóng gói, palette, ô tìm, Node info).
// Trang chạy trong cùng scheme `nxpage://` nên dùng lại cầu nối chọn nút của #68.
// ---------------------------------------------------------------------------

export const COMMUNITY_NODE_LIMIT = 2_000
export const COMMUNITY_EDGE_LIMIT = 20_000
/** graph.json lớn hơn ngưỡng này không nạp (JSON.parse cả tệp sẽ tốn RAM của main). */
export const MAX_GRAPH_JSON_BYTES = 256 * 1024 * 1024

export interface CommunityGraphNode {
  id: string
  label: string
  file: string | null
  line: number | null
  fileType: string | null
  degree: number
  /** `community_name` của chính nút (có thể null). */
  name: string | null
}

export interface CommunityGraphEdge { from: string; to: string; relation: string | null }

export interface CommunityGraph {
  community: number
  name: string
  nodes: CommunityGraphNode[]
  edges: CommunityGraphEdge[]
  /** Tổng số thành viên trước khi cắt còn `COMMUNITY_NODE_LIMIT`. */
  total: number
  truncated: boolean
}

interface GraphJsonNode extends CommunityGraphNode { community: number | null; communityName: string | null }
interface GraphJsonGraph { mtimeMs: number; nodes: Map<string, GraphJsonNode>; links: [string, string, string | null][] }

const graphJsonCache = new Map<string, GraphJsonGraph>()

const tidy = (value: unknown, max = 512): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : null

/** `community` của graph.json có thể là số hoặc chuỗi số; còn lại coi như không có. */
export const communityNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000) return value
  if (typeof value === 'string' && /^\d{1,7}$/.test(value)) return Number(value)
  return null
}

/** Đọc graph.json một lần, giữ dạng gọn (không giữ metadata của Graphify); cache theo mtime. */
async function loadGraphJson(root: string): Promise<GraphJsonGraph | null> {
  const file = join(graphPagesDir(root), 'graph.json')
  try {
    const info = await stat(file)
    const cached = graphJsonCache.get(file)
    if (cached && cached.mtimeMs === info.mtimeMs) return cached
    if (info.size > MAX_GRAPH_JSON_BYTES) return null
    const data = JSON.parse(await readFile(file, 'utf8')) as { nodes?: unknown; links?: unknown; edges?: unknown }
    if (!data || typeof data !== 'object') return null
    const nodes = new Map<string, GraphJsonNode>()
    for (const raw of Array.isArray(data.nodes) ? data.nodes : []) {
      if (!raw || typeof raw !== 'object') continue
      const node = raw as Record<string, unknown>
      const id = tidy(node.id)
      if (!id || nodes.has(id)) continue
      nodes.set(id, {
        id,
        label: tidy(node.label, 2000) ?? id,
        file: tidy(node.source_file, 1024),
        line: lineFromSourceLocation(node.source_location),
        fileType: tidy(node.file_type, 64),
        degree: 0,
        name: tidy(node.community_name, 2000),
        community: communityNumber(node.community),
        communityName: tidy(node.community_name, 2000)
      })
    }
    const links: [string, string, string | null][] = []
    const rawLinks = Array.isArray(data.links) ? data.links : Array.isArray(data.edges) ? data.edges : []
    for (const raw of rawLinks) {
      if (!raw || typeof raw !== 'object') continue
      const link = raw as Record<string, unknown>
      const from = tidy(link.source ?? link.from)
      const to = tidy(link.target ?? link.to)
      if (!from || !to || from === to) continue
      const a = nodes.get(from)
      const b = nodes.get(to)
      if (!a || !b) continue
      a.degree++
      b.degree++
      links.push([from, to, tidy(link.relation, 64)])
    }
    const graph: GraphJsonGraph = { mtimeMs: info.mtimeMs, nodes, links }
    graphJsonCache.set(file, graph)
    return graph
  } catch {
    return null
  }
}

/**
 * NG-ACT-2: thành viên của một cộng đồng + cạnh giữa chúng, tối đa `COMMUNITY_NODE_LIMIT`
 * nút (ưu tiên bậc cao). graph.json hỏng/không có, cộng đồng không tồn tại → null.
 */
export async function readGraphJsonCommunity(root: string, community: number): Promise<CommunityGraph | null> {
  if (!Number.isInteger(community) || community < 0) return null
  const graph = await loadGraphJson(root)
  if (!graph) return null
  const matched: GraphJsonNode[] = []
  let name = ''
  for (const node of graph.nodes.values()) {
    if (node.community !== community) continue
    matched.push(node)
    if (!name && node.communityName) name = node.communityName
  }
  if (!matched.length) return null
  matched.sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const kept = matched.slice(0, COMMUNITY_NODE_LIMIT)
  const ids = new Set(kept.map((node) => node.id))
  const edges: CommunityGraphEdge[] = []
  for (const [from, to, relation] of graph.links) {
    if (!ids.has(from) || !ids.has(to)) continue
    edges.push({ from, to, relation })
    if (edges.length >= COMMUNITY_EDGE_LIMIT) break
  }
  return {
    community,
    name: name || `Community ${community}`,
    nodes: kept.map(({ id, label, file, line, fileType, degree, name: nodeName }) => ({ id, label, file, line, fileType, degree, name: nodeName })),
    edges,
    total: matched.length,
    truncated: matched.length > kept.length
  }
}

const TYPE_COLORS: Record<string, string> = { code: '#4E79A7', document: '#F28E2B', image: '#E15759', other: '#76B7B2' }
const typeColor = (type: string | null): string => TYPE_COLORS[type ?? ''] ?? TYPE_COLORS.other
const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
/** Nhúng JSON vào <script>: `<` thành \u003c để nhãn chứa </script> không phá trang. */
const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const typeLabel = (type: string): string =>
  type === 'code' ? 'Code' : type === 'document' ? 'Document' : type === 'image' ? 'Image' : 'Other'

/** HTML của trang cộng đồng; không phụ thuộc Electron để test bằng Node. */
export function renderCommunityPage(graph: CommunityGraph): string {
  const counts = new Map<string, number>()
  for (const node of graph.nodes) {
    const type = node.fileType ?? 'other'
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  const legend = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([type, count]) => ({ t: type, color: typeColor(type), label: typeLabel(type), count }))
  const rawNodes = graph.nodes.map((node) => {
    const color = typeColor(node.fileType)
    return {
      id: node.id,
      label: node.label,
      color: { background: color, border: color, highlight: { background: '#ffffff', border: color } },
      size: Math.round((8 + Math.sqrt(node.degree + 1) * 4) * 10) / 10,
      font: { size: 12, color: '#ffffff' },
      title: node.label,
      community: graph.community,
      community_name: node.name ?? graph.name,
      source_file: node.file ?? '',
      source_location: node.file && node.line ? `${node.file}:${node.line}` : null,
      file_type: node.fileType ?? '',
      degree: node.degree,
      t: node.fileType ?? 'other'
    }
  })
  const rawEdges = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    label: '',
    title: edge.relation ?? '',
    dashes: false,
    width: 1,
    color: { opacity: 0.35 },
    confidence: edge.relation ? 'EXTRACTED' : 'INFERRED'
  }))
  const nodeCount = graph.nodes.length
  const edgeCount = graph.edges.length
  const stats = `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'} &middot; ${edgeCount} ${edgeCount === 1 ? 'edge' : 'edges'}${graph.truncated ? ` &middot; top ${nodeCount} of ${graph.total}` : ''}`
  const title = `NexGraph — Community: ${graph.name}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"
        integrity="sha384-${VIS_INTEGRITY}" crossorigin="anonymous"></script>
<style>
  :root {
    --bg: #0f0f1a; --panel: #1a1a2e; --border: #2a2a4e; --input-border: #3a3a5e;
    --text: #e0e0e0; --text-2: #aaa; --text-3: #ccc; --muted: #555; --count: #666;
    --neighbor-border: #333; --node-label: #ffffff;
  }
  [data-theme="light"] {
    --bg: #ffffff; --panel: #f8f9fa; --border: #d9dee5; --input-border: #c3cad4;
    --text: #222222; --text-2: #666666; --text-3: #333333; --muted: #888888; --count: #777777;
    --neighbor-border: #ccc; --node-label: #222222;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; height: 100vh; overflow: hidden; }
  #graph { flex: 1; }
  #sidebar { width: 280px; background: var(--panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
  #community-head { padding: 12px 14px; border-bottom: 1px solid var(--border); }
  #community-name { font-size: 13px; color: var(--text); line-height: 1.4; }
  #community-meta { font-size: 11px; color: var(--muted); margin-top: 4px; }
  #search-wrap { padding: 12px; border-bottom: 1px solid var(--border); }
  #search { width: 100%; background: var(--bg); border: 1px solid var(--input-border); color: var(--text); padding: 7px 10px; border-radius: 6px; font-size: 13px; outline: none; }
  #search:focus { border-color: #4E79A7; }
  #search-results { max-height: 140px; overflow-y: auto; padding: 4px 12px; border-bottom: 1px solid var(--border); display: none; }
  .search-item { padding: 4px 6px; cursor: pointer; border-radius: 4px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search-item:hover { background: var(--border); }
  #info-panel { padding: 14px; border-bottom: 1px solid var(--border); min-height: 140px; }
  #info-panel h3 { font-size: 13px; color: var(--text-2); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  #info-content { font-size: 13px; color: var(--text-3); line-height: 1.6; }
  #info-content .field { margin-bottom: 5px; }
  #info-content .field b { color: var(--text); }
  #info-content .empty { color: var(--muted); font-style: italic; }
  .neighbor-link { display: block; padding: 2px 6px; margin: 2px 0; border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-left: 3px solid var(--neighbor-border); }
  .neighbor-link:hover { background: var(--border); }
  #neighbors-list { max-height: 160px; overflow-y: auto; margin-top: 4px; }
  #legend-wrap { flex: 1; overflow-y: auto; padding: 12px; }
  #legend-wrap h3 { font-size: 13px; color: var(--text-2); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  .legend-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .legend-item:hover { background: var(--border); padding-left: 4px; }
  .legend-item.dimmed { opacity: 0.35; }
  .legend-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .legend-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend-count { color: var(--count); font-size: 11px; }
  #stats { padding: 10px 14px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); }
  #theme-wrap { display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  #theme-wrap button { flex: 1; background: var(--bg); color: var(--text-2); border: 1px solid var(--input-border); border-radius: 4px; padding: 3px 0; font-size: 11px; cursor: pointer; }
  #theme-wrap button:hover { color: var(--text); }
  #theme-wrap button[aria-pressed="true"] { background: #4E79A7; border-color: #4E79A7; color: #fff; }
</style>
<script id="nx-theme-init">
(function () {
  var pref = null;
  try { pref = localStorage.getItem('graphify-theme'); } catch (e) {}
  var t = pref === 'light' ? 'light'
    : pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light'
    : 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();
</script>
</head>
<body>
<div id="graph"></div>
<div id="sidebar">
  <div id="community-head">
    <div id="community-name">Community: <b>${escapeHtml(graph.name)}</b></div>
    <div id="community-meta">${graph.total} ${graph.total === 1 ? 'member' : 'members'}${graph.truncated ? ` · showing ${graph.nodes.length} by degree` : ''}</div>
  </div>
  <div id="theme-wrap" role="group" aria-label="Theme">
    <button type="button" data-theme-choice="light">Light</button>
    <button type="button" data-theme-choice="dark">Dark</button>
    <button type="button" data-theme-choice="system">System</button>
  </div>
  <div id="search-wrap">
    <input id="search" type="text" placeholder="Search nodes..." autocomplete="off">
    <div id="search-results"></div>
  </div>
  <div id="info-panel">
    <h3>Node Info</h3>
    <div id="info-content"><span class="empty">Click a node to inspect it</span></div>
  </div>
  <div id="legend-wrap">
    <h3>Types</h3>
    <div id="legend"></div>
  </div>
  <div id="stats">${stats}</div>
</div>
<script>
const RAW_NODES = ${jsonForScript(rawNodes)};
const RAW_EDGES = ${jsonForScript(rawEdges)};
const LEGEND = ${jsonForScript(legend)};
window.__nxCommunityStats = { community: ${graph.community}, nodes: RAW_NODES.length, edges: RAW_EDGES.length, total: ${graph.total}, truncated: ${graph.truncated ? 'true' : 'false'} };

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const nodesDS = new vis.DataSet(RAW_NODES.map(function (n, i) {
  return { id: n.id, label: n.label, color: n.color, size: n.size, font: n.font, title: n.title,
    x: 30 * Math.sqrt(i) * Math.cos(i * 2.4), y: 30 * Math.sqrt(i) * Math.sin(i * 2.4),
    community: n.community, community_name: n.community_name, source_file: n.source_file,
    source_location: n.source_location, file_type: n.file_type, degree: n.degree, t: n.t };
}));

const edgesDS = new vis.DataSet(RAW_EDGES.map(function (e, i) {
  return { id: i, from: e.from, to: e.to, label: e.label, title: e.title, dashes: e.dashes,
    width: e.width, color: e.color, arrows: { to: { enabled: true, scaleFactor: 0.5 } } };
}));

const container = document.getElementById('graph');
const network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      gravitationalConstant: -60,
      centralGravity: 0.005,
      springLength: 120,
      springConstant: 0.08,
      damping: 0.4,
      avoidOverlap: 0.8
    },
    stabilization: { iterations: 200, fit: true }
  },
  interaction: { hover: true, tooltipDelay: 100, hideEdgesOnDrag: true, navigationButtons: false, keyboard: false },
  nodes: { shape: 'dot', borderWidth: 1.5 },
  edges: { smooth: { type: 'continuous', roundness: 0.2 }, selectionWidth: 3 }
});

const THEME_KEY = 'graphify-theme';
const themeMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
let themeLabelColor = '#ffffff';
function themePref() {
  let p = null;
  try { p = localStorage.getItem(THEME_KEY); } catch (e) {}
  return (p === 'light' || p === 'dark' || p === 'system') ? p : null;
}
function applyTheme(pref) {
  const t = pref === 'light' ? 'light' : (pref === 'system' && themeMQ && themeMQ.matches) ? 'light' : 'dark';
  const root = document.documentElement;
  if (!root) return;
  root.setAttribute('data-theme', t);
  document.querySelectorAll('[data-theme-choice]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === (pref || 'dark')));
  });
  const labelColor = getComputedStyle(root).getPropertyValue('--node-label').trim();
  if (labelColor && labelColor !== themeLabelColor) {
    themeLabelColor = labelColor;
    nodesDS.update(nodesDS.get().map(function (n) { return { id: n.id, font: Object.assign({}, n.font, { color: labelColor }) }; }));
  }
}
document.querySelectorAll('[data-theme-choice]').forEach(function (b) {
  b.addEventListener('click', function () {
    const pref = b.dataset.themeChoice;
    try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
    applyTheme(pref);
  });
});
if (themeMQ) {
  const onSchemeChange = function () { if (themePref() === 'system') applyTheme('system'); };
  if (themeMQ.addEventListener) themeMQ.addEventListener('change', onSchemeChange);
  else if (themeMQ.addListener) themeMQ.addListener(onSchemeChange);
}
applyTheme(themePref());

network.once('stabilizationIterationsDone', function () {
  network.setOptions({ physics: { enabled: false } });
  window.__nxReady = true;
});
setTimeout(function () { window.__nxReady = true; }, 3000);

function showInfo(nodeId) {
  const n = nodesDS.get(nodeId);
  if (!n) return;
  const neighborIds = network.getConnectedNodes(nodeId);
  const neighborItems = neighborIds.map(function (nid) {
    const nb = nodesDS.get(nid);
    const color = (nb && nb.color) ? nb.color.background : '#555';
    return '<span class="neighbor-link" style="border-left-color:' + esc(color) + '" data-nid="' + esc(nid) + '">' + esc(nb ? nb.label : nid) + '</span>';
  }).join('');
  let html = '<div class="field"><b>' + esc(n.label) + '</b></div>';
  html += '<div class="field">Type: ' + esc(n.file_type || 'unknown') + '</div>';
  html += '<div class="field">Community: ' + esc(n.community_name || '') + '</div>';
  if (n.source_file) html += '<div class="field">Source: ' + esc(n.source_file) + '</div>';
  html += '<div class="field">Degree: ' + n.degree + '</div>';
  if (neighborIds.length) {
    html += '<div class="field" style="margin-top:8px;color:var(--text-2);font-size:11px">Neighbors (' + neighborIds.length + ')</div><div id="neighbors-list">' + neighborItems + '</div>';
  }
  document.getElementById('info-content').innerHTML = html;
}

function focusNode(nodeId) {
  network.focus(nodeId, { scale: 1.4, animation: true });
  network.selectNodes([nodeId]);
  showInfo(nodeId);
}

document.addEventListener('click', function (e) {
  const el = e.target.closest('.neighbor-link');
  if (el && el.dataset.nid !== undefined) focusNode(el.dataset.nid);
});

const searchInput = document.getElementById('search');
const searchResults = document.getElementById('search-results');
searchInput.addEventListener('input', function () {
  const q = searchInput.value.toLowerCase().trim();
  searchResults.innerHTML = '';
  if (!q) { searchResults.style.display = 'none'; return; }
  const matches = nodesDS.get().filter(function (n) { return String(n.label).toLowerCase().indexOf(q) !== -1; }).slice(0, 20);
  if (!matches.length) { searchResults.style.display = 'none'; return; }
  searchResults.style.display = 'block';
  matches.forEach(function (n) {
    const el = document.createElement('div');
    el.className = 'search-item';
    el.textContent = n.label;
    el.onclick = function () {
      network.focus(n.id, { scale: 1.5, animation: true });
      network.selectNodes([n.id]);
      showInfo(n.id);
      searchResults.style.display = 'none';
      searchInput.value = '';
    };
    searchResults.appendChild(el);
  });
});
document.addEventListener('click', function (e) {
  if (!searchResults.contains(e.target) && e.target !== searchInput) searchResults.style.display = 'none';
});

const hiddenTypes = new Set();
const legendEl = document.getElementById('legend');
LEGEND.forEach(function (c) {
  const item = document.createElement('div');
  item.className = 'legend-item';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'legend-cb';
  cb.checked = true;
  cb.addEventListener('change', function () {
    if (cb.checked) hiddenTypes.delete(c.t); else hiddenTypes.add(c.t);
    item.classList.toggle('dimmed', !cb.checked);
    nodesDS.update(RAW_NODES.filter(function (n) { return n.t === c.t; }).map(function (n) { return { id: n.id, hidden: !cb.checked }; }));
  });
  item.innerHTML = '<div class="legend-dot" style="background:' + c.color + '"></div><span class="legend-label">' + esc(c.label) + '</span><span class="legend-count">' + c.count + '</span>';
  item.prepend(cb);
  item.onclick = function (e) {
    if (e.target === cb) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change'));
  };
  legendEl.appendChild(item);
});
</script>
</body>
</html>`
}

