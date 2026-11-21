import { useTheme } from '../../state/useTheme'

// Bộ icon Symbols (MIT, Miguel Solorio) lấy từ Wu; hai bảng tra là phần con của icon_theme.json, xem THIRD_PARTY_LICENSES.md.
const urls = import.meta.glob<string>('../../assets/file-icons/*.svg', { eager: true, query: '?url', import: 'default' })

const BY_NAME: Record<string, string> = {
  '.gitignore': 'git', '.gitattributes': 'git', '.env': 'gear', '.editorconfig': 'editorconfig', '.prettierrc': 'prettier',
  '.eslintrc': 'eslint', Dockerfile: 'docker', 'docker-compose.yml': 'docker-pink', LICENSE: 'license', Makefile: 'gear',
  'package.json': 'node', 'package-lock.json': 'node', 'tsconfig.json': 'tsconfig', 'CLAUDE.md': 'claude',
  'requirements.txt': 'python', 'pyproject.toml': 'gear', 'uv.lock': 'uv', 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn',
  'vite.config.ts': 'vite', 'go.mod': 'go-mod'
}

const BY_SUFFIX: Record<string, string> = {
  ts: 'ts', mts: 'ts', cts: 'ts', 'd.ts': 'ts-types', tsx: 'react-ts', js: 'js', mjs: 'js', cjs: 'js', jsx: 'react',
  py: 'python', pyi: 'python', ipynb: 'notebook', cs: 'csharp', csproj: 'visual-studio', sln: 'visual-studio', dart: 'dart',
  md: 'markdown', mdx: 'mdx', json: 'brackets-yellow', jsonc: 'brackets-yellow', yml: 'yaml', yaml: 'yaml',
  html: 'code-orange', htm: 'code-orange', css: 'brackets-purple', scss: 'sass', sass: 'sass', less: 'brackets-sky',
  svg: 'svg', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', ico: 'image', gif: 'gif', txt: 'text',
  toml: 'gear', ini: 'gear', cfg: 'gear', conf: 'gear', env: 'gear',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'shell', bat: 'shell',
  sql: 'database', db: 'database', sqlite: 'database', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin',
  gradle: 'gradle', swift: 'swift', c: 'c', h: 'h', cpp: 'cplus', cc: 'cplus', hpp: 'cplus', php: 'php', rb: 'ruby',
  vue: 'vue', svelte: 'svelte', astro: 'astro', lua: 'lua', r: 'r', xml: 'xml', csv: 'csv', pdf: 'pdf',
  zip: 'compressed', gz: 'compressed', tar: 'compressed', lock: 'lock', graphql: 'graphql', gql: 'graphql',
  proto: 'proto', tf: 'terraform', prisma: 'prisma'
}

/** Tên icon cho một tệp: khớp nguyên tên trước, rồi đuôi dài nhất (`a.d.ts` → `d.ts` trước `ts`). */
export function fileIconName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  if (BY_NAME[base]) return BY_NAME[base]
  const lower = base.toLowerCase()
  for (let dot = lower.indexOf('.', 1); dot >= 0; dot = lower.indexOf('.', dot + 1)) {
    const icon = BY_SUFFIX[lower.slice(dot + 1)]
    if (icon) return icon
  }
  return 'default'
}

export function FileTypeIcon({ name, size = 16 }: { name: string; size?: number }) {
  const dark = useTheme() === 'dark'
  const icon = `../../assets/file-icons/${fileIconName(name)}`
  return <img className="file-type-icon" src={(dark && urls[`${icon}.dark.svg`]) || urls[`${icon}.svg`]}
    width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}
