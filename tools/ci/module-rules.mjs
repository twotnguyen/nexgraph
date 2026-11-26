#!/usr/bin/env node
// Kiểm luật phụ thuộc giữa module (ADR 0026).
//   engine:  import-linter, hợp đồng trong engine/pyproject.toml ([tool.importlinter])
//   desktop: dependency-cruiser, luật trong apps/desktop/.dependency-cruiser.cjs
// Mặc định chỉ báo cáo (pha 0): in vi phạm, thoát 0. `--strict`: thoát 1 khi còn vi phạm (pha 4).
// Công cụ không chạy được thì luôn thoát 1, để lỗi cấu hình không bị che thành "sạch".
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const IMPORT_LINTER = 'import-linter==2.16'
export const DEPENDENCY_CRUISER = 'dependency-cruiser@18.7.2'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const strict = process.argv.includes('--strict')
const win = process.platform === 'win32'

function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: win })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, error: r.error }
}

/** Đếm vi phạm trong đầu ra của import-linter. */
export function parseImportLinter(out) {
  const m = /Contracts: (\d+) kept, (\d+) broken\./.exec(out)
  if (!m) return null
  const imports = out.split('\n').filter((l) => /^-\s+\S+ -> \S+/.test(l)).length
  return { kept: Number(m[1]), broken: Number(m[2]), violations: imports }
}

/** Đếm vi phạm trong đầu ra `--output-type err` của dependency-cruiser. */
export function parseDepcruise(out) {
  if (/no dependency violations found/.test(out)) {
    const mods = /\((\d+) modules/.exec(out)
    return { errors: 0, warnings: 0, violations: 0, modules: mods ? Number(mods[1]) : null }
  }
  const m = /(\d+) dependency violations \((\d+) errors?, (\d+) warnings?\)\. (\d+) modules/.exec(out)
  if (!m) return null
  return { violations: Number(m[1]), errors: Number(m[2]), warnings: Number(m[3]), modules: Number(m[4]) }
}

function engine() {
  const env = { PYTHONPATH: join(root, 'engine', 'src') }
  const r = run('uvx', ['--from', IMPORT_LINTER, 'lint-imports', '--config', 'pyproject.toml'], join(root, 'engine'), env)
  return { name: 'engine (import-linter)', out: r.out, stats: parseImportLinter(r.out), error: r.error }
}

function desktop() {
  const dir = join(root, 'apps', 'desktop')
  const modules = join(dir, 'node_modules')
  // dependency-cruiser cần TypeScript của dự án; chạy qua npx thì chỉ thấy nó qua NODE_PATH.
  if (!existsSync(join(modules, 'typescript', 'package.json'))) {
    return { name: 'desktop (dependency-cruiser)', out: 'Thiếu apps/desktop/node_modules/typescript: chạy `pnpm install` trước.', stats: null }
  }
  const args = ['--yes', '-p', DEPENDENCY_CRUISER, 'depcruise', '--config', '.dependency-cruiser.cjs', '--output-type', 'err', 'src', 'test', 'e2e']
  const r = run('npx', args, dir, { NODE_PATH: modules })
  return { name: 'desktop (dependency-cruiser)', out: r.out, stats: parseDepcruise(r.out), error: r.error }
}

function summary(results) {
  const rows = results.map(({ name, stats }) => {
    if (!stats) return `| ${name} | không chạy được |`
    if ('kept' in stats) return `| ${name} | ${stats.broken} hợp đồng vi phạm / ${stats.kept + stats.broken}; ${stats.violations} import vi phạm |`
    return `| ${name} | ${stats.errors} lỗi, ${stats.warnings} cảnh báo trên ${stats.modules} module |`
  })
  const details = results.map(({ name, out }) => `<details><summary>${name}</summary>\n\n\`\`\`text\n${out.trim()}\n\`\`\`\n</details>`)
  const mode = strict ? 'chặn (`--strict`)' : 'chỉ báo cáo (ADR 0026, pha 0)'
  return [`## Luật phụ thuộc module — ${mode}`, '', '| Phần | Kết quả |', '|---|---|', ...rows, '', ...details, ''].join('\n')
}

function main() {
  const results = [engine(), desktop()]
  for (const { name, out } of results) console.log(`\n===== ${name} =====\n${out.trim()}`)
  const text = summary(results)
  console.log(`\n${text.split('<details>')[0]}`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)

  if (results.some((r) => !r.stats)) process.exit(1)
  const dirty = results.some(({ stats }) => ('broken' in stats ? stats.broken > 0 : stats.errors > 0 || stats.warnings > 0))
  process.exit(strict && dirty ? 1 : 0)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
