#!/usr/bin/env node
// Chọn phần CI cần chạy cho một PR theo danh sách tệp đổi (job `changes` của .github/workflows/ci.yml).
//
// Nguyên tắc: chỉ BỎ phần việc khi chắc tệp đổi không ảnh hưởng tới nó; đường dẫn chưa biết thì chạy đủ.
// Push lên main và tag luôn chạy đủ (job truyền `--all`), nên thứ lọt qua bộ lọc của PR vẫn bị bắt
// ngay trên commit merge. Job bắt buộc không bị bỏ, chỉ bỏ các bước nặng, để 8 check của
// ruleset `main-guard` luôn có kết quả.
//
// Đầu vào của test nằm ngoài thư mục của chính nó (đã kiểm khi viết luật):
//   - engine/tests/indexing/test_docs_secrets.py quét MỌI tệp *.md của repo  → .md bật engine 'docs'
//   - engine/tests/core/test_schema.py đọc design/database/*.sql              → engine 'full'
//   - engine/tests/repo/test_version_consistency.py đọc package.json gốc và của desktop
//   - test desktop đọc .github/workflows/ci.yml, tools/ci/*, engine/tests/fixtures/** (E2E),
//     ảnh trong docs/ và design/ (agent-images.test.ts)                         → tệp không phải .md ở đó bật desktop
//
// Dùng: node tools/ci/changes.mjs --files <tệp danh sách> | --all
//   Ghi engine=full|docs|skip, desktop|package|labs=true|false vào $GITHUB_OUTPUT (nếu có) và in JSON.
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ALL = Object.freeze({ engine: 'full', desktop: true, package: true, labs: true })

const ENGINE_LEVEL = { skip: 0, docs: 1, full: 2 }
const need = (engine, desktop, pkg, labs) => ({ engine, desktop, package: pkg, labs })

/** Phần CI một tệp cần. Thứ tự luật quan trọng: luật cụ thể trước, tệp lạ rơi về ALL. */
function needOf(file) {
  const f = file.replaceAll('\\', '/')
  const md = f.endsWith('.md')
  const base = (() => {
    if (f.startsWith('.github/') || f.startsWith('tools/ci/')) return ALL
    // Đi kèm bộ cài (extraResources), không phải tài liệu thường.
    if (['THIRD_PARTY_LICENSES.md', 'NOTICE', 'LICENSE'].includes(f)) return need('docs', true, true, false)
    if (f.startsWith('engine/tests/fixtures/')) return need('full', true, false, false)
    if (f.startsWith('engine/tests/')) return need('full', false, false, false)
    if (f.startsWith('design/database/')) return need('full', false, false, false)
    if (f.startsWith('labs/')) return need('skip', false, false, true)
    if ((f.startsWith('apps/desktop/') || f.startsWith('packages/')) && (f.includes('/test/') || /\.test\.[cm]?[jt]sx?$/.test(f))) {
      return need('skip', true, false, false)
    }
    if (f.startsWith('apps/desktop/src/renderer/')) return need('skip', true, false, true)
    if (f === 'apps/desktop/package.json') return ALL
    if (f.startsWith('apps/desktop/') || f.startsWith('packages/')) return need('skip', true, true, true)
    if (['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(f)) return ALL
    if (md) return need('docs', false, false, false)
    if (f.startsWith('engine/')) return need('full', true, true, false)
    // Ảnh trong docs/ và design/ là đầu vào test desktop (agent-images.test.ts đọc ảnh nghiệm thu và logo).
    if (f.startsWith('docs/') || f.startsWith('design/')) return need('skip', true, false, false)
    return ALL
  })()
  // Mọi .md đều là đầu vào của test_docs_secrets.
  return md && base.engine === 'skip' ? { ...base, engine: 'docs' } : base
}

/** Hợp phần CI cần của mọi tệp. Không có danh sách (lỗi API, PR rỗng) thì chạy tất cả. */
export function classify(files) {
  if (!Array.isArray(files) || files.length === 0) return { ...ALL }
  const out = need('skip', false, false, false)
  for (const file of files) {
    const n = needOf(file)
    if (ENGINE_LEVEL[n.engine] > ENGINE_LEVEL[out.engine]) out.engine = n.engine
    out.desktop ||= n.desktop
    out.package ||= n.package
    out.labs ||= n.labs
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--files')
  let result = { ...ALL }
  if (!args.includes('--all') && at >= 0) {
    try {
      result = classify(readFileSync(args[at + 1], 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    } catch (error) {
      console.error(`Không đọc được danh sách tệp, chạy tất cả: ${error.message}`)
    }
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([k, v]) => `${k}=${v}\n`).join(''))
  }
  console.log(JSON.stringify(result))
}
