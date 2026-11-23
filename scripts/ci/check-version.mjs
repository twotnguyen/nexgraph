#!/usr/bin/env node
/**
 * REL-07 / REL-06 — so version của tag phát hành với cả 4 nguồn version trong repo.
 *
 * Dùng trong CI:
 *   node scripts/ci/check-version.mjs "$GITHUB_REF_NAME"
 * Chạy cục bộ (kiểm trước khi push tag):
 *   node scripts/ci/check-version.mjs v0.2.0-alpha.1
 *
 * Quy ước pre-release: tag/npm dùng semver `0.2.0-alpha.1`, `-beta.2`, `-rc.3`;
 * Python dùng PEP 440 `0.2.0a1`, `0.2.0b2`, `0.2.0rc3`. Tag phát hành chỉ nhận
 * semver — mọi tag pre-release đều có dấu `-` để job `release` thêm `--prerelease`;
 * dạng PEP 440 như `v0.2.0a1` bị từ chối kèm gợi ý tag đúng.
 * Khi so: hai nguồn npm phải khớp nguyên văn tag (bỏ đúng một `v`), chỉ hai nguồn
 * Python mới được chuẩn hoá semver -> PEP 440.
 *
 * Không phụ thuộc gói ngoài để job `version-check` chạy được trên runner sạch.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..', '..');

/** 4 nguồn version — đúng danh sách đợt V1 sẽ tăng version. */
const SOURCES = [
  { file: 'package.json', parse: parseJsonVersion, format: 'npm' },
  { file: 'apps/desktop/package.json', parse: parseJsonVersion, format: 'npm' },
  { file: 'engine/pyproject.toml', parse: parseTomlVersion, format: 'pep440' },
  { file: 'engine/src/nexgraph_engine/__init__.py', parse: parsePythonVersion, format: 'pep440' },
];

const PRE_RELEASE = [
  [/-(?:alpha)\.(\d+)$/i, 'a$1'],
  [/-(?:beta)\.(\d+)$/i, 'b$1'],
  [/-(?:rc)\.(\d+)$/i, 'rc$1'],
];

/** Tag phát hành: semver của dự án, pre-release luôn có `-` (PEP 440 không dùng cho tag). */
const RELEASE_TAG = /^v(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?)$/;

const TAG_FORMAT =
  'tag phải có dạng vX.Y.Z (bản cuối) hoặc vX.Y.Z-alpha.N / vX.Y.Z-beta.N / vX.Y.Z-rc.N';

/** Chuẩn hoá version về dạng so sánh được: bỏ tiền tố `v`, semver pre-release -> PEP 440. */
export function normalizeVersion(raw) {
  let version = String(raw).trim().toLowerCase();
  if (version.startsWith('v')) version = version.slice(1);
  for (const [pattern, replacement] of PRE_RELEASE) version = version.replace(pattern, replacement);
  return version;
}

/** Gợi ý tag semver đúng từ tag PEP 440 (`v0.2.0a1`) hoặc thiếu dấu chấm (`-alpha1`). */
export function suggestTag(raw) {
  const body = String(raw).trim().replace(/^refs\/tags\//i, '').replace(/^v/i, '');
  const pep440 = /^(\d+\.\d+\.\d+)(a|b|rc)(\d+)$/i.exec(body);
  if (pep440) {
    const label = pep440[2].toLowerCase() === 'a' ? 'alpha' : pep440[2].toLowerCase() === 'b' ? 'beta' : 'rc';
    return `v${pep440[1]}-${label}.${pep440[3]}`;
  }
  const thieuCham = /^(\d+\.\d+\.\d+)(-(?:alpha|beta|rc))(\d+)$/i.exec(body);
  if (thieuCham) return `v${thieuCham[1]}${thieuCham[2]}.${thieuCham[3]}`;
  return null;
}

function parseJsonVersion(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed.version !== 'string' || parsed.version === '') {
    throw new Error('không có trường "version" dạng chuỗi');
  }
  return parsed.version;
}

function parseTomlVersion(text) {
  // `version = "..."` ở cấp cao nhất của [project] (không nằm trong bảng con).
  const match = /^version\s*=\s*"([^"]+)"/m.exec(text);
  if (!match) throw new Error('không thấy dòng version = "..."');
  return match[1];
}

function parsePythonVersion(text) {
  const match = /^__version__\s*=\s*["']([^"']+)["']/m.exec(text);
  if (!match) throw new Error('không thấy __version__ = "..."');
  return match[1];
}

function usage(message) {
  if (message) console.error(`LỖI: ${message}`);
  console.error('Dùng: node scripts/ci/check-version.mjs <tag> [--root <thư mục repo>]');
  console.error('Ví dụ: node scripts/ci/check-version.mjs v0.2.0-alpha.1');
  process.exit(2);
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  let tag = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[i + 1];
      if (!value) usage('--root cần đường dẫn');
      root = resolve(value);
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      usage();
    } else if (arg.startsWith('--')) {
      usage(`tham số lạ: ${arg}`);
    } else if (tag) {
      usage(`chỉ nhận một tag, thừa: ${arg}`);
    } else {
      tag = arg;
    }
  }
  return { root, tag };
}

function main() {
  const { root, tag: rawTag } = parseArgs(process.argv.slice(2));
  if (!rawTag) usage('thiếu tham số tag (ví dụ v0.2.0-alpha.1)');

  const tag = rawTag.trim().replace(/^refs\/tags\//, '');
  const tagMatch = RELEASE_TAG.exec(tag);
  if (!tagMatch) {
    console.error(`LỖI: tag "${rawTag}" không hợp lệ: ${TAG_FORMAT}`);
    const suggestion = suggestTag(tag);
    console.error(
      suggestion
        ? `GỢI Ý: dùng "${suggestion}" — PEP 440 (0.2.0a1) chỉ dùng trong engine/pyproject.toml và engine/src/nexgraph_engine/__init__.py, không dùng cho tag phát hành.`
        : 'Ví dụ: node scripts/ci/check-version.mjs v0.2.0-alpha.1',
    );
    process.exit(1);
  }
  const expectedNpm = tagMatch[1];
  const expectedPython = normalizeVersion(tag);

  const width = Math.max(...SOURCES.map((source) => source.file.length));
  const rows = [];
  let failed = 0;

  for (const source of SOURCES) {
    const path = join(root, source.file);
    let raw;
    try {
      raw = source.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      failed += 1;
      rows.push({ file: source.file, raw: '-', normalized: '-', ok: false, error: error.message });
      continue;
    }
    const expected = source.format === 'npm' ? expectedNpm : expectedPython;
    const normalized = source.format === 'npm' ? String(raw).trim() : normalizeVersion(raw);
    const ok = normalized === expected;
    if (!ok) failed += 1;
    rows.push({ file: source.file, raw, normalized, ok, error: null });
  }

  console.log(`tag ${rawTag} -> npm ${expectedNpm} / Python ${expectedPython}`);
  for (const row of rows) {
    const status = row.ok ? 'OK' : row.error ? `LỖI (${row.error})` : 'LỆCH';
    console.log(
      `  ${row.file.padEnd(width)}  ${String(row.raw).padEnd(18)} -> ${String(row.normalized).padEnd(18)} ${status}`,
    );
  }

  if (failed > 0) {
    console.error(
      `LỖI: ${failed}/${SOURCES.length} nguồn version không khớp tag ${rawTag} (npm ${expectedNpm} / Python ${expectedPython})`,
    );
    process.exit(1);
  }
  console.log(
    `OK: tag ${rawTag} khớp cả ${SOURCES.length} nguồn version (npm ${expectedNpm} / Python ${expectedPython})`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
