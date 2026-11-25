#!/usr/bin/env node
/**
 * CI-1 — phân loại vùng thay đổi để CI chỉ chạy phần cần thiết trên PR.
 *
 * Cách dùng trong workflow (job `changes`):
 *   PR:    node scripts/ci/changed-areas.mjs --base "origin/$BASE_REF" --github-output
 *   push:  node scripts/ci/changed-areas.mjs --all --github-output
 *
 * Chạy tay để kiểm:
 *   node scripts/ci/changed-areas.mjs --files "docs/a.md\0engine/src/x.py\0" --json
 *
 * Quy ước cờ (lead chốt, đợt CI-1):
 *   engine    engine/**, scripts/engine/**
 *   desktop   apps/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml,
 *             tsconfig*.json, biome.json*, scripts/** (trừ scripts/engine/**)
 *   packaging engine/src/**, engine/packaging/**, engine/pyproject.toml,
 *             engine/uv.lock, apps/desktop/src/**, apps/desktop/electron-builder.yml,
 *             apps/desktop/scripts/**, apps/desktop/resources/**,
 *             apps/desktop/package.json, apps/desktop/nex-runtime.json,
 *             pnpm-lock.yaml, THIRD_PARTY_LICENSES.md
 *   ci        .github/** — bật cờ này thì MỌI cờ khác = true (đổi CI phải chạy đủ).
 *
 * Không phụ thuộc gói ngoài: job `changes` chạy trên runner sạch chỉ với Node.
 * Không dùng `on.pull_request.paths`: workflow không chạy thì check bắt buộc treo,
 * PR bị chặn. Job vẫn chạy, chỉ các BƯỚC nặng bị bỏ qua theo cờ.
 */
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Thứ tự cờ cố định — dùng cho JSON, $GITHUB_OUTPUT và dòng tổng kết. */
export const AREAS = ['engine', 'desktop', 'packaging', 'ci'];

/** Luật khớp theo đường dẫn tương đối gốc repo, chuẩn hoá `/`. */
const RULES = {
  engine: [/^engine\//, /^scripts\/engine\//],
  desktop: [
    /^apps\//,
    /^package\.json$/,
    /^pnpm-lock\.yaml$/,
    /^pnpm-workspace\.yaml$/,
    /^tsconfig[^/]*\.json$/,
    /^biome\.json[^/]*$/,
    /^scripts\//,
  ],
  packaging: [
    /^engine\/src\//,
    /^engine\/packaging\//,
    /^engine\/pyproject\.toml$/,
    /^engine\/uv\.lock$/,
    /^apps\/desktop\/src\//,
    /^apps\/desktop\/electron-builder\.yml$/,
    /^apps\/desktop\/scripts\//,
    /^apps\/desktop\/resources\//,
    /^apps\/desktop\/package\.json$/,
    /^apps\/desktop\/nex-runtime\.json$/,
    /^pnpm-lock\.yaml$/,
    /^THIRD_PARTY_LICENSES\.md$/,
  ],
};

/** Chuẩn hoá đường dẫn git (Windows trả `\`, có thể có `./`). */
function normalizePath(raw) {
  return String(raw).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function isEngineScript(path) {
  return path.startsWith('scripts/engine/');
}

/** Phân loại thuần: danh sách đường dẫn -> cờ. */
export function classify(paths) {
  const flags = { engine: false, desktop: false, packaging: false, ci: false };
  for (const raw of paths) {
    const path = normalizePath(raw);
    if (!path) continue;
    if (path.startsWith('.github/')) flags.ci = true;
    if (RULES.engine.some((rule) => rule.test(path))) flags.engine = true;
    if (RULES.packaging.some((rule) => rule.test(path))) flags.packaging = true;
    // `scripts/**` vào desktop, trừ `scripts/engine/**` (đã thuộc engine).
    if (RULES.desktop.some((rule) => rule.test(path)) && !isEngineScript(path)) flags.desktop = true;
  }
  // Đổi chính CI thì không đoán: chạy đầy đủ để thay đổi workflow luôn được kiểm.
  if (flags.ci) return { engine: true, desktop: true, packaging: true, ci: true };
  return flags;
}

/** Tách đầu ra `git diff --name-only -z` (NUL) — nhận cả chuỗi rỗng. */
export function parseNameOnly(raw) {
  return String(raw)
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Danh sách truyền qua `--files`: nhận cả NUL lẫn xuống dòng (argv không chứa được NUL). */
export function parseFileList(raw) {
  return String(raw)
    .split(/[\0\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Chạy git trong gốc repo; lỗi thì ném kèm stderr để log CI đọc được. */
function gitDiffNames(base, head) {
  const res = spawnSync('git', ['diff', '--name-only', '-z', `${base}...${head}`], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw new Error(`không chạy được git: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(
      `git diff ${base}...${head} lỗi (mã ${res.status}): ${(res.stderr || '').trim()}`,
    );
  }
  return parseNameOnly(res.stdout);
}

function usage(message) {
  if (message) console.error(`LỖI: ${message}`);
  console.error(
    'Dùng: node scripts/ci/changed-areas.mjs [--all | --base <ref> [--head <ref>] | --files <ds NUL>] [--json] [--github-output]',
  );
  console.error('Ví dụ: node scripts/ci/changed-areas.mjs --base origin/main --github-output');
  process.exit(2);
}

function parseArgs(argv) {
  const options = { all: false, base: 'origin/main', head: 'HEAD', files: null, json: false, githubOutput: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') options.all = true;
    else if (arg === '--base') options.base = argv[++i] || usage('--base cần một ref');
    else if (arg === '--head') options.head = argv[++i] || usage('--head cần một ref');
    else if (arg === '--files') options.files = argv[++i] ?? usage('--files cần danh sách');
    else if (arg === '--json') options.json = true;
    else if (arg === '--github-output') options.githubOutput = true;
    else if (arg === '-h' || arg === '--help') usage();
    else usage(`tham số lạ: ${arg}`);
  }
  if (options.all && options.files !== null) usage('--all và --files loại trừ nhau');
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let files;
  if (options.all) {
    files = null;
  } else if (options.files !== null) {
    files = parseFileList(options.files);
  } else {
    files = gitDiffNames(options.base, options.head);
  }

  const flags = options.all
    ? { engine: true, desktop: true, packaging: true, ci: true }
    : classify(files || []);

  // JSON chỉ in ra stdout để test/script khác parse được; phần người đọc đi stderr.
  if (options.json) {
    process.stdout.write(`${JSON.stringify(flags)}\n`);
  } else {
    process.stdout.write(`${AREAS.map((area) => `${area}=${flags[area]}`).join(' ')}\n`);
  }

  if (options.all) {
    console.error('push lên main hoặc tag: chạy đầy đủ (mọi cờ = true)');
  } else {
    console.error(`${files.length} tệp thay đổi → ${AREAS.map((area) => `${area}=${flags[area]}`).join(' ')}`);
    const changed = [...new Set(files)].sort();
    const limit = 40;
    for (const path of changed.slice(0, limit)) console.error(`  ${path}`);
    if (changed.length > limit) console.error(`  … và ${changed.length - limit} tệp nữa`);
  }

  if (options.githubOutput) {
    const target = process.env.GITHUB_OUTPUT;
    if (!target) usage('--github-output cần biến môi trường GITHUB_OUTPUT');
    appendFileSync(target, `${AREAS.map((area) => `${area}=${flags[area]}`).join('\n')}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`LỖI: ${error.message}`);
    process.exit(1);
  }
}
