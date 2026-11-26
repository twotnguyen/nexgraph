import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { resolveInside } from '../../platform/project-fs'
import { fail, git, safePaths } from './repo'

type Kind = 'github' | 'gitlab' | 'gitea' | 'bitbucket' | 'bitbucket-server' | 'sourcehut'
type Parts = { base: string; owner: string; repo: string; sha: string; file: string }

/** URL xem tệp tại một commit và mảnh `#…` chọn dòng, theo định dạng web của từng dịch vụ. */
const LINKS: Record<Kind, { url: (p: Parts) => string; lines: (a: number, b: number) => string }> = {
  github: { url: (p) => `${p.base}/${p.owner}/${p.repo}/blob/${p.sha}/${p.file}`, lines: (a, b) => (a === b ? `L${a}` : `L${a}-L${b}`) },
  gitlab: { url: (p) => `${p.base}/${p.owner}/${p.repo}/-/blob/${p.sha}/${p.file}`, lines: (a, b) => (a === b ? `L${a}` : `L${a}-${b}`) },
  gitea: { url: (p) => `${p.base}/${p.owner}/${p.repo}/src/commit/${p.sha}/${p.file}`, lines: (a, b) => (a === b ? `L${a}` : `L${a}-L${b}`) },
  bitbucket: { url: (p) => `${p.base}/${p.owner}/${p.repo}/src/${p.sha}/${p.file}`, lines: (a, b) => (a === b ? `lines-${a}` : `lines-${a}:${b}`) },
  'bitbucket-server': { url: (p) => `${p.base}/projects/${p.owner}/repos/${p.repo}/browse/${p.file}?at=${p.sha}`, lines: (a, b) => (a === b ? `${a}` : `${a}-${b}`) },
  sourcehut: { url: (p) => `${p.base}/${p.owner}/${p.repo}/tree/${p.sha}/item/${p.file}`, lines: (a, b) => (a === b ? `L${a}` : `L${a}-${b}`) }
}

/** Nhận dạng máy chủ theo tên miền: dịch vụ công cộng và bản tự dựng (tên miền chứa tên dịch vụ). Khớp đầu tiên thắng. */
const HOSTS: [RegExp, Kind][] = [
  [/^bitbucket\.org$/, 'bitbucket'], [/^git\.sr\.ht$|sourcehut/, 'sourcehut'], [/^codeberg\.org$|forgejo|gitea/, 'gitea'],
  [/gitlab/, 'gitlab'], [/github/, 'github'], [/bitbucket/, 'bitbucket-server']
]

/** Percent-encode theo RFC 3986 (cả `!'()*`) để dán vào Markdown không gãy. */
const encodeSegment = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)

/**
 * Giao thức web, host (kèm cổng nếu là web) và đường dẫn kho từ URL remote: `https://`, `ssh://`, `git://` hoặc dạng scp `[user@]host:owner/repo`.
 * Đường dẫn cục bộ, `file://` và ổ đĩa Windows (`C:\…`) không phải remote web.
 */
export function parseRemote(raw: string): { scheme: 'http' | 'https'; host: string; path: string } | null {
  const url = raw.trim()
  const scp = /^(?:[^/@:\s]+@)?([^/@:\s]+):(?!\/\/)(.*)$/.exec(url)
  if (scp && scp[1].length > 1) return { scheme: 'https', host: scp[1].toLowerCase(), path: scp[2] }
  try {
    const parsed = new URL(url)
    if (!parsed.hostname || parsed.protocol === 'file:') return null
    const web = parsed.protocol === 'http:' || parsed.protocol === 'https:'
    return { scheme: parsed.protocol === 'http:' ? 'http' : 'https', host: (web ? parsed.host : parsed.hostname).toLowerCase(), path: decodeURIComponent(parsed.pathname) }
  } catch {
    return null
  }
}

/** `start`/`end` tính từ 1; bỏ trống `start` thì link tới cả tệp. `file` là đường dẫn từ gốc kho. */
export function permalinkUrl(remote: string, sha: string, file: string, start?: number, end?: number): string {
  const parsed = parseRemote(remote)
  // ssh.github.com, altssh.gitlab.com…: máy chủ ssh thay thế, trang web nằm ở tên miền gốc.
  const host = parsed?.host.replace(/^(?:alt)?ssh\./, '') ?? ''
  const kind = HOSTS.find(([pattern]) => pattern.test(host.replace(/:\d+$/, '')))?.[1]
  const segments = parsed?.path.split('/').filter(Boolean) ?? []
  if (kind === 'bitbucket-server' && segments[0] === 'scm' && segments.length > 2) segments.shift()
  if (!parsed || !kind || segments.length < 2 || !/^[a-z0-9._-]+(?::\d+)?$/.test(host)) {
    throw fail('unsupported_remote', `Không tạo được permalink cho remote${parsed ? ` (${parsed.host})` : ''}: chỉ hỗ trợ GitHub, GitLab, Bitbucket, Gitea/Forgejo/Codeberg và SourceHut qua https hoặc ssh.`)
  }
  const last = segments.pop() as string
  // SourceHut coi `repo` và `repo.git` là hai kho khác nhau.
  const repo = encodeSegment(kind === 'sourcehut' ? last : last.replace(/\.git$/, ''))
  const owner = segments.map(encodeSegment).join('/')
  const path = file.split('/').map(encodeSegment).join('/')
  // GitHub/GitLab dựng sẵn Markdown nên không có neo dòng; `plain=1` hiện nguồn.
  const plain = (kind === 'github' || kind === 'gitlab') && /\.md$/i.test(file) ? '?plain=1' : ''
  const fragment = start === undefined ? '' : `#${LINKS[kind].lines(start, end ?? start)}`
  return `${LINKS[kind].url({ base: `${parsed.scheme}://${host}`, owner, repo, sha, file: path })}${plain}${fragment}`
}

/**
 * Dòng trong tệp đang sửa → dòng tương ứng ở HEAD, theo các khối `@@ -a,b +c,d @@` của `git diff -U0`.
 * Dòng nằm trong vùng thêm/sửa quy về vùng cũ tương ứng (vùng chỉ thêm thì về dòng đứng trước nó).
 */
export function headLine(diff: string, line: number): number {
  let shift = 0
  for (const [, a, b = '1', c, d = '1'] of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [oldStart, oldCount, newStart, newCount] = [a, b, c, d].map(Number)
    // Khối chỉ xoá (newCount = 0) ghi `c` là dòng đứng ngay trước chỗ xoá.
    if (line < (newCount === 0 ? newStart + 1 : newStart)) break
    if (line < newStart + newCount) {
      return oldCount === 0 ? Math.max(oldStart, 1) : Math.min(oldStart + line - newStart, oldStart + oldCount - 1)
    }
    shift += oldCount - newCount
  }
  return line + shift
}

function lineRange(start: unknown, end: unknown): [number, number] | null {
  if (start === undefined && end === undefined) return null
  if (!Number.isSafeInteger(start) || (start as number) < 1 || !(end === undefined || (Number.isSafeInteger(end) && (end as number) >= (start as number)))) {
    throw fail('bad_param', 'Số dòng không hợp lệ')
  }
  return [start as number, (end ?? start) as number]
}

const lf = (text: string): string => text.replace(/\r\n?/g, '\n')

/** `git diff -U0` từ tệp ở HEAD tới nội dung đang soạn (cả hai về LF để kiểu xuống dòng không làm lệch), kể cả khi chưa lưu. */
async function diffFromHead(root: string, blob: string, current: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ng-permalink-'))
  try {
    await writeFile(join(dir, 'head'), lf(await git(root, ['cat-file', 'blob', blob])))
    await writeFile(join(dir, 'now'), lf(current))
    return await git(dir, ['diff', '--no-index', '-U0', '--no-color', '--no-ext-diff', '--', 'head', 'now'], { okCodes: [1] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Permalink tới dòng của một tệp trong dự án, trên remote của nhánh hiện tại (không có thì `origin`, hoặc remote duy nhất), tại commit HEAD.
 * Số dòng là của nội dung đang soạn `text` (mặc định bản trên đĩa), được quy về dòng của HEAD.
 * `published` false khi remote chưa có HEAD (theo lần fetch cuối): liên kết vẫn đúng định dạng nhưng trang web có thể báo 404.
 */
export async function gitPermalink(root: string, file: unknown, start?: unknown, end?: unknown, text?: unknown): Promise<{ url: string; published: boolean }> {
  const [projectPath] = safePaths(root, [file])
  const range = lineRange(start, end)
  if (text !== undefined && typeof text !== 'string') throw fail('bad_param', 'Nội dung tệp không hợp lệ')
  const [prefix, head, branchRaw, remoteList] = await Promise.all([
    git(root, ['rev-parse', '--show-prefix']),
    git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { okCodes: [1] }),
    git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { okCodes: [1] }),
    git(root, ['remote'])
  ])
  const sha = head.trim()
  if (!sha) throw fail('no_commit', 'Kho chưa có commit nào')
  const relativePath = relative(resolve(root, '.'), resolve(root, projectPath)).split(sep).join('/')
  const repoPath = `${prefix.replace(/\r?\n$/, '')}${relativePath}`
  if ((await git(root, ['cat-file', '-t', `${sha}:${repoPath}`]).catch(() => '')).trim() !== 'blob') {
    throw fail('not_committed', 'Tệp chưa có trong commit HEAD. Hãy commit trước khi tạo permalink.')
  }

  const remotes = remoteList.split('\n').filter(Boolean)
  const branch = branchRaw.trim()
  const upstream = branch ? (await git(root, ['config', '--get', `branch.${branch}.remote`], { okCodes: [1] })).trim() : ''
  const remote = remotes.includes(upstream) ? upstream : remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : ''
  if (!remote) throw fail('no_remote', remotes.length ? 'Không xác định được remote (không có origin)' : 'Kho chưa có remote nào')
  const [remoteUrl, published] = await Promise.all([
    git(root, ['remote', 'get-url', '--', remote]),
    git(root, ['for-each-ref', `--contains=${sha}`, '--format=%(refname)', `refs/remotes/${remote}/`]).then((refs) => !!refs.trim())
  ])

  let lines: [number, number] | null = range
  if (range) {
    const current = text ?? await readFile(resolveInside(root, projectPath), 'utf8').catch(() => { throw fail('file_not_found', 'Không đọc được tệp trên đĩa') })
    const diff = await diffFromHead(root, `${sha}:${repoPath}`, current)
    const first = headLine(diff, range[0])
    lines = [first, Math.max(first, headLine(diff, range[1]))]
  }
  return { url: permalinkUrl(remoteUrl.trim(), sha, repoPath, lines?.[0], lines?.[1]), published }
}
