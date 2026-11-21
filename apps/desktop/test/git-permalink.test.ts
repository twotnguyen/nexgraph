import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitPermalink, headLine, permalinkUrl } from '../src/main/git/permalink'

const SHA = 'e6ebe7974deb6bb6cc0e2595c8ec31f0c71084b7'
const FILE = 'crates/editor/src/git/permalink.rs'
type Row = [name: string, remote: string, file: string, start: number | undefined, end: number | undefined, expected: string]

describe('permalinkUrl: remote → URL web theo từng máy chủ', () => {
  const rows: Row[] = [
    ['github scp, dải dòng', 'git@github.com:o/r.git', FILE, 3, 5, `https://github.com/o/r/blob/${SHA}/${FILE}#L3-L5`],
    ['github https, một dòng', 'https://github.com/o/r.git', FILE, 7, 7, `https://github.com/o/r/blob/${SHA}/${FILE}#L7`],
    ['github, bỏ end thì là một dòng', 'https://github.com/o/r', FILE, 7, undefined, `https://github.com/o/r/blob/${SHA}/${FILE}#L7`],
    ['github ssh://, không có dòng', 'ssh://git@github.com/o/r.git', FILE, undefined, undefined, `https://github.com/o/r/blob/${SHA}/${FILE}`],
    ['github https có tài khoản và mật khẩu: không lộ ra link', 'https://user:secret@github.com/o/r.git', FILE, 1, 2, `https://github.com/o/r/blob/${SHA}/${FILE}#L1-L2`],
    ['github scp có / đầu đường dẫn', 'git@github.com:/o/r', FILE, 1, 1, `https://github.com/o/r/blob/${SHA}/${FILE}#L1`],
    ['github scp không có user', 'github.com:o/r.git', FILE, 1, 1, `https://github.com/o/r/blob/${SHA}/${FILE}#L1`],
    ['github ssh qua cổng 443 (ssh.github.com)', 'ssh://git@ssh.github.com:443/o/r.git', FILE, 1, 1, `https://github.com/o/r/blob/${SHA}/${FILE}#L1`],
    ['github tên miền viết hoa và / cuối', 'https://GitHub.com/o/r/', FILE, 1, 1, `https://github.com/o/r/blob/${SHA}/${FILE}#L1`],
    ['github Enterprise', 'git@github.acme.com:team/r.git', FILE, 2, 4, `https://github.acme.com/team/r/blob/${SHA}/${FILE}#L2-L4`],
    ['github Markdown cần plain=1 để có neo dòng', 'git@github.com:o/r.git', 'docs/README.md', 2, 4, `https://github.com/o/r/blob/${SHA}/docs/README.md?plain=1#L2-L4`],

    ['gitlab có subgroup', 'git@gitlab.com:g/sub/r.git', FILE, 3, 5, `https://gitlab.com/g/sub/r/-/blob/${SHA}/${FILE}#L3-5`],
    ['gitlab một dòng', 'https://gitlab.com/g/r.git', FILE, 9, 9, `https://gitlab.com/g/r/-/blob/${SHA}/${FILE}#L9`],
    ['gitlab tự dựng', 'https://gitlab.acme.org/team/r.git', FILE, 1, 2, `https://gitlab.acme.org/team/r/-/blob/${SHA}/${FILE}#L1-2`],
    ['gitlab Markdown', 'git@gitlab.com:g/r.git', 'README.md', 1, 1, `https://gitlab.com/g/r/-/blob/${SHA}/README.md?plain=1#L1`],

    ['bitbucket cloud, dải dòng', 'git@bitbucket.org:o/r.git', FILE, 3, 5, `https://bitbucket.org/o/r/src/${SHA}/${FILE}#lines-3:5`],
    ['bitbucket cloud, một dòng', 'https://bitbucket.org/o/r.git', FILE, 7, 7, `https://bitbucket.org/o/r/src/${SHA}/${FILE}#lines-7`],
    ['bitbucket server qua ssh có cổng', 'ssh://git@bitbucket.acme.com:7999/PROJ/r.git', FILE, 3, 5, `https://bitbucket.acme.com/projects/PROJ/repos/r/browse/${FILE}?at=${SHA}#3-5`],
    ['bitbucket server qua https /scm/', 'https://bitbucket.acme.com/scm/PROJ/r.git', FILE, 4, 4, `https://bitbucket.acme.com/projects/PROJ/repos/r/browse/${FILE}?at=${SHA}#4`],

    ['codeberg', 'git@codeberg.org:o/r.git', FILE, 3, 5, `https://codeberg.org/o/r/src/commit/${SHA}/${FILE}#L3-L5`],
    ['gitea.com', 'https://gitea.com/o/r.git', FILE, 7, 7, `https://gitea.com/o/r/src/commit/${SHA}/${FILE}#L7`],
    ['gitea tự dựng chạy http có cổng', 'http://gitea.acme.net:3000/o/r.git', FILE, 3, 3, `http://gitea.acme.net:3000/o/r/src/commit/${SHA}/${FILE}#L3`],
    ['forgejo tự dựng', 'git@forgejo.acme.net:o/r.git', FILE, 2, 3, `https://forgejo.acme.net/o/r/src/commit/${SHA}/${FILE}#L2-L3`],

    ['sourcehut', 'git@git.sr.ht:~user/repo', FILE, 3, 5, `https://git.sr.ht/~user/repo/tree/${SHA}/item/${FILE}#L3-5`],
    ['sourcehut coi repo.git là kho khác', 'https://git.sr.ht/~user/repo.git', FILE, 3, 3, `https://git.sr.ht/~user/repo.git/tree/${SHA}/item/${FILE}#L3`],

    ['mã hoá ký tự đặc biệt từng đoạn đường dẫn', 'git@github.com:o/r.git', "src/a b/(x)!'*#1?.ts", 1, 1, `https://github.com/o/r/blob/${SHA}/src/a%20b/%28x%29%21%27%2A%231%3F.ts#L1`],
    ['mã hoá tên tệp tiếng Việt', 'git@github.com:o/r.git', 'tài liệu/tệp é.ts', 2, 2, `https://github.com/o/r/blob/${SHA}/t%C3%A0i%20li%E1%BB%87u/t%E1%BB%87p%20%C3%A9.ts#L2`]
  ]
  it.each(rows)('%s', (_name, remote, file, start, end, expected) => {
    expect(permalinkUrl(remote, SHA, file, start, end)).toBe(expected)
  })

  it.each([
    'https://example.com/o/r.git', '/srv/git/r.git', 'C:\\repos\\r', 'file:///srv/r.git', 'not a url', '',
    'git@github.com:onlyone', 'https://github.com/', 'ssh://git@github.com'
  ])('remote lạ hoặc thiếu owner/repo bị từ chối: %j', (remote) => {
    expect(() => permalinkUrl(remote, SHA, FILE, 1, 1)).toThrow(expect.objectContaining({ code: 'unsupported_remote' }))
  })

  it('thông báo lỗi chỉ nêu máy chủ, không lộ mật khẩu trong URL remote', () => {
    expect(() => permalinkUrl('https://user:secret@example.com/o/r.git', SHA, FILE, 1, 1))
      .toThrow(expect.objectContaining({ message: expect.stringContaining('example.com') }))
    try { permalinkUrl('https://user:secret@example.com/o/r.git', SHA, FILE, 1, 1) } catch (error) {
      expect((error as Error).message).not.toContain('secret')
    }
  })
})

describe('headLine: quy số dòng của bản đang sửa về HEAD', () => {
  // HEAD: l1..l6. Đang sửa: thêm "new0" ở đầu, sửa l3, xoá l5, thêm "extra" ở cuối.
  const diff = ['@@ -0,0 +1 @@', '+new0', '@@ -3 +4 @@ l2', '-l3', '+l3 changed', '@@ -5 +5,0 @@ l4', '-l5', '@@ -6,0 +7 @@ l6', '+extra', ''].join('\n')
  it('dòng không đổi dịch theo các khối trước nó, dòng thêm/sửa về vùng cũ', () => {
    // dòng đang sửa 1..7 = new0, l1, l2, "l3 changed", l4, l6, extra
    expect([1, 2, 3, 4, 5, 6, 7].map((line) => headLine(diff, line))).toEqual([1, 1, 2, 3, 4, 6, 6])
    expect(headLine('', 5)).toBe(5)
  })
})

describe('gitPermalink trên kho thật', () => {
  let repo: string
  let root: string // dự án là thư mục con của kho
  const sh = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  const head = () => sh('rev-parse', 'HEAD')
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'ng-permalink-'))
    root = join(repo, 'app')
    mkdirSync(join(root, 'src'), { recursive: true })
    sh('init', '-q', '-b', 'main')
    sh('config', 'user.email', 'test@example.com')
    sh('config', 'user.name', 'Người Thử')
    writeFileSync(join(root, 'src/a.ts'), 'l1\nl2\nl3\nl4\nl5\nl6\n')
    writeFileSync(join(repo, 'outside.txt'), 'x\n')
    sh('add', '.')
    sh('commit', '-q', '-m', 'đầu tiên')
    sh('remote', 'add', 'origin', 'git@github.com:o/r.git')
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('link tới dải dòng tại HEAD, đường dẫn tính từ gốc kho (dự án là thư mục con)', async () => {
    expect(await gitPermalink(root, 'src/a.ts', 3, 5)).toEqual({ url: `https://github.com/o/r/blob/${head()}/app/src/a.ts#L3-L5`, published: false })
    expect((await gitPermalink(root, 'src/../src/a.ts', 2, 2)).url).toBe(`https://github.com/o/r/blob/${head()}/app/src/a.ts#L2`)
    expect((await gitPermalink(root, 'src/a.ts')).url).toBe(`https://github.com/o/r/blob/${head()}/app/src/a.ts`)
  })

  it('published chỉ đúng khi remote được dùng đã có HEAD', async () => {
    sh('update-ref', 'refs/remotes/other/main', 'HEAD')
    expect((await gitPermalink(root, 'src/a.ts', 1, 1)).published).toBe(false)
    sh('update-ref', 'refs/remotes/origin/main', 'HEAD')
    expect((await gitPermalink(root, 'src/a.ts', 1, 1)).published).toBe(true)
    writeFileSync(join(root, 'src/b.ts'), 'x\n')
    sh('add', '.')
    sh('commit', '-q', '-m', 'thứ hai')
    expect((await gitPermalink(root, 'src/a.ts', 1, 1)).published).toBe(false)
  })

  it('quy số dòng của bản đang sửa về dòng trong commit HEAD', async () => {
    writeFileSync(join(root, 'src/a.ts'), 'new1\nnew2\nl1\nl2\nl3\nl4\nl5\nl6\n')
    expect((await gitPermalink(root, 'src/a.ts', 5, 6)).url).toBe(`https://github.com/o/r/blob/${head()}/app/src/a.ts#L3-L4`)
    writeFileSync(join(root, 'src/a.ts'), 'l2\nl3\nl4\nl5\nl6\n')
    expect((await gitPermalink(root, 'src/a.ts', 1, 2)).url).toBe(`https://github.com/o/r/blob/${head()}/app/src/a.ts#L2-L3`)
    writeFileSync(join(root, 'src/a.ts'), 'l1\nl2\nL3 sửa\nl4\nl5\nl6\n')
    expect((await gitPermalink(root, 'src/a.ts', 2, 4)).url).toBe(`https://github.com/o/r/blob/${head()}/app/src/a.ts#L2-L4`)
  })


  it('ánh xạ theo nội dung đang soạn chưa lưu và không phụ thuộc kiểu xuống dòng', async () => {
    await expect(gitPermalink(root, 'src/a.ts', 5, 6, 'new1\nnew2\nl1\nl2\nl3\nl4\nl5\nl6\n'))
      .resolves.toMatchObject({ url: `https://github.com/o/r/blob/${head()}/app/src/a.ts#L3-L4` })
    expect((await gitPermalink(root, 'src/a.ts', 5, 6)).url).toBe(`https://github.com/o/r/blob/${head()}/app/src/a.ts#L5-L6`)
    expect((await gitPermalink(root, 'src/a.ts', 2, 2, 'l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nl6\r\n')).url)
      .toBe(`https://github.com/o/r/blob/${head()}/app/src/a.ts#L2`)
    await expect(gitPermalink(root, 'src/a.ts', 1, 1, 42)).rejects.toMatchObject({ code: 'bad_param' })
  })

  it('từ chối tệp chưa commit, đường dẫn ngoài dự án và số dòng sai', async () => {
    writeFileSync(join(root, 'new.ts'), 'x\n')
    await expect(gitPermalink(root, 'new.ts', 1, 1)).rejects.toMatchObject({ code: 'not_committed' })
    await expect(gitPermalink(root, 'src', 1, 1)).rejects.toMatchObject({ code: 'not_committed' })
    await expect(gitPermalink(root, '../outside.txt', 1, 1)).rejects.toMatchObject({ code: 'outside_project' })
    for (const [start, end] of [[0, 1], [1.5, 2], [3, 2], [undefined, 4], ['1', 2], [Number.NaN, 1]]) {
      await expect(gitPermalink(root, 'src/a.ts', start, end), JSON.stringify([start, end])).rejects.toMatchObject({ code: 'bad_param' })
    }
  })

  it('chọn remote của nhánh hiện tại, rồi origin, rồi remote duy nhất; còn lại báo lỗi', async () => {
    sh('remote', 'add', 'gl', 'git@gitlab.com:g/r.git')
    expect((await gitPermalink(root, 'src/a.ts', 1, 1)).url).toContain('https://github.com/o/r/blob/')
    sh('config', 'branch.main.remote', 'gl')
    expect((await gitPermalink(root, 'src/a.ts', 1, 1)).url).toBe(`https://gitlab.com/g/r/-/blob/${head()}/app/src/a.ts#L1`)

    sh('config', '--unset', 'branch.main.remote')
    sh('remote', 'remove', 'origin')
    await expect(gitPermalink(root, 'src/a.ts', 1, 1)).resolves.toMatchObject({ url: expect.stringContaining('https://gitlab.com/g/r/') })
    sh('remote', 'add', 'second', 'git@bitbucket.org:o/r.git')
    await expect(gitPermalink(root, 'src/a.ts', 1, 1)).rejects.toMatchObject({ code: 'no_remote' })
    sh('remote', 'remove', 'gl')
    sh('remote', 'remove', 'second')
    await expect(gitPermalink(root, 'src/a.ts', 1, 1)).rejects.toMatchObject({ code: 'no_remote', message: expect.stringContaining('chưa có remote') })
  })

  it('dùng URL remote sau khi áp url.insteadOf và báo lỗi khi máy chủ không được hỗ trợ', async () => {
    sh('remote', 'set-url', 'origin', 'git@internal:o/r.git')
    sh('config', 'url.https://github.com/.insteadOf', 'git@internal:')
    expect((await gitPermalink(root, 'src/a.ts', 1, 1)).url).toBe(`https://github.com/o/r/blob/${head()}/app/src/a.ts#L1`)
    sh('config', '--unset', 'url.https://github.com/.insteadOf')
    await expect(gitPermalink(root, 'src/a.ts', 1, 1)).rejects.toMatchObject({ code: 'unsupported_remote' })
    sh('remote', 'set-url', 'origin', '/srv/git/r.git')
    await expect(gitPermalink(root, 'src/a.ts', 1, 1)).rejects.toMatchObject({ code: 'unsupported_remote' })
  })

  it('kho chưa có commit nào', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ng-permalink-empty-'))
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty })
      writeFileSync(join(empty, 'a.ts'), 'x\n')
      await expect(gitPermalink(empty, 'a.ts', 1, 1)).rejects.toMatchObject({ code: 'no_commit' })
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
