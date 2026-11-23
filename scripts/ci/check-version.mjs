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
 * Python dùng PEP 440 `0.2.0a1`, `0.2.0b2`, `0.2.0rc3`. Hai dạng được coi là
 * tương đương sau khi chuẩn hoá về PEP 440.
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
  { file: 'package.json', parse: parseJsonVersion },
  { file: 'apps/desktop/package.json', parse: parseJsonVersion },
  { file: 'engine/pyproject.toml', parse: parseTomlVersion },
  { file: 'engine/src/nexgraph_engine/__init__.py', parse: parsePythonVersion },
];

const PRE_RELEASE = [
  [/-(?:alpha)\.(\d+)$/i, 'a$1'],
  [/-(?:beta)\.(\d+)$/i, 'b$1'],
  [/-(?:rc)\.(\d+)$/i, 'rc$1'],
];

const VALID_TAG = /^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+|[-.][0-9a-z.-]+)?$/i;

/** Chuẩn hoá version về dạng so sánh được: bỏ tiền tố `v`, semver pre-release -> PEP 440. */
export function normalizeVersion(raw) {
  let version = String(raw).trim().toLowerCase();
  if (version.startsWith('v')) version = version.slice(1);
  for (const [pattern, replacement] of PRE_RELEASE) version = version.replace(pattern, replacement);
  return version;
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

  const tag = rawTag.replace(/^refs\/tags\//, '');
  const bareTag = tag.replace(/^v/i, '');
  if (!VALID_TAG.test(bareTag)) {
    console.error(`LỖI: tag "${rawTag}" không phải version hợp lệ (cần X.Y.Z hoặc X.Y.Z-<pre-release>)`);
    process.exit(1);
  }
  const expected = normalizeVersion(tag);

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
    const normalized = normalizeVersion(raw);
    const ok = normalized === expected;
    if (!ok) failed += 1;
    rows.push({ file: source.file, raw, normalized, ok, error: null });
  }

  console.log(`tag ${rawTag} -> ${expected}`);
  for (const row of rows) {
    const status = row.ok ? 'OK' : row.error ? `LỖI (${row.error})` : 'LỆCH';
    console.log(
      `  ${row.file.padEnd(width)}  ${String(row.raw).padEnd(18)} -> ${String(row.normalized).padEnd(18)} ${status}`,
    );
  }

  if (failed > 0) {
    console.error(`LỖI: ${failed}/${SOURCES.length} nguồn version không khớp tag ${rawTag} (${expected})`);
    process.exit(1);
  }
  console.log(`OK: tag ${rawTag} khớp cả ${SOURCES.length} nguồn version (${expected})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
