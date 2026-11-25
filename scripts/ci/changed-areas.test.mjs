import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AREAS, classify, parseNameOnly } from './changed-areas.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'changed-areas.mjs');
const ROOT = resolve(HERE, '..', '..');
const NUL = String.fromCharCode(0);
const BACKSLASH = String.fromCharCode(92);

/** Bảng tệp -> cờ, mỗi dòng là một tình huống PR thật. */
const TABLE = [
  {
    name: 'docs-only: chỉ tài liệu, không cờ nào',
    files: ['docs/project/tong-quan.md', 'README.md', 'design/logo/logo.svg'],
    expected: { engine: false, desktop: false, packaging: false, ci: false },
  },
  {
    name: 'engine-only: mã engine + test engine',
    files: ['engine/src/nexgraph_engine/cli.py', 'engine/tests/test_cli.py'],
    expected: { engine: true, desktop: false, packaging: true, ci: false },
  },
  {
    name: 'engine-only: script engine không kéo desktop',
    files: ['scripts/engine/reindex.mjs'],
    expected: { engine: true, desktop: false, packaging: false, ci: false },
  },
  {
    name: 'desktop-only: mã renderer của desktop',
    files: ['apps/desktop/src/renderer/App.tsx'],
    expected: { engine: false, desktop: true, packaging: true, ci: false },
  },
  {
    name: 'desktop-only: tệp cấu hình gốc của workspace',
    files: ['tsconfig.base.json', 'biome.jsonc', 'pnpm-workspace.yaml'],
    expected: { engine: false, desktop: true, packaging: false, ci: false },
  },
  {
    name: 'lockfile: đổi pnpm-lock.yaml -> desktop + packaging',
    files: ['pnpm-lock.yaml'],
    expected: { engine: false, desktop: true, packaging: true, ci: false },
  },
  {
    name: 'package.json gốc -> desktop (không packaging)',
    files: ['package.json'],
    expected: { engine: false, desktop: true, packaging: false, ci: false },
  },
  {
    name: 'script CI mới -> desktop theo luật scripts/**',
    files: ['scripts/ci/changed-areas.mjs', 'scripts/ci/changed-areas.test.mjs'],
    expected: { engine: false, desktop: true, packaging: false, ci: false },
  },
  {
    name: '.github: đổi workflow -> mọi cờ true',
    files: ['.github/workflows/ci.yml'],
    expected: { engine: true, desktop: true, packaging: true, ci: true },
  },
  {
    name: '.github: chỉ một tệp .github cũng bật toàn bộ',
    files: ['docs/x.md', '.github/ISSUE_TEMPLATE/bug.md'],
    expected: { engine: true, desktop: true, packaging: true, ci: true },
  },
  {
    name: 'packaging: tài liệu giấy phép bên thứ ba',
    files: ['THIRD_PARTY_LICENSES.md'],
    expected: { engine: false, desktop: false, packaging: true, ci: false },
  },
  {
    name: 'packaging: cấu hình runtime Nex của desktop',
    files: ['apps/desktop/nex-runtime.json'],
    expected: { engine: false, desktop: true, packaging: true, ci: false },
  },
  {
    name: 'packaging: spec PyInstaller thuộc engine + packaging',
    files: ['engine/packaging/nexgraph-engine.spec'],
    expected: { engine: true, desktop: false, packaging: true, ci: false },
  },
  {
    name: 'packaging: uv.lock + pyproject của engine',
    files: ['engine/uv.lock', 'engine/pyproject.toml'],
    expected: { engine: true, desktop: false, packaging: true, ci: false },
  },
  {
    name: 'packaging: electron-builder.yml và script đóng gói desktop',
    files: ['apps/desktop/electron-builder.yml', 'apps/desktop/scripts/check-installer.mjs'],
    expected: { engine: false, desktop: true, packaging: true, ci: false },
  },
  {
    name: 'danh sách rỗng -> không cờ nào',
    files: [],
    expected: { engine: false, desktop: false, packaging: false, ci: false },
  },
  {
    name: 'đường dẫn kiểu Windows vẫn phân loại đúng',
    files: [`engine${BACKSLASH}src${BACKSLASH}nexgraph_engine${BACKSLASH}cli.py`],
    expected: { engine: true, desktop: false, packaging: true, ci: false },
  },
];

for (const row of TABLE) {
  test(row.name, () => {
    assert.deepEqual(classify(row.files), row.expected);
  });
}

test('AREAS có đúng 4 cờ theo thứ tự cố định', () => {
  assert.deepEqual(AREAS, ['engine', 'desktop', 'packaging', 'ci']);
});

test('parseNameOnly tách đầu ra git -z, bỏ tệp rỗng', () => {
  assert.deepEqual(parseNameOnly(['a.md', 'engine/x.py', ''].join(NUL)), ['a.md', 'engine/x.py']);
  assert.deepEqual(parseNameOnly(''), []);
});

test('CLI --all: push main/tag -> mọi cờ true', () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--all', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout.trim()), {
    engine: true,
    desktop: true,
    packaging: true,
    ci: true,
  });
});

test('CLI --files: phân loại danh sách cho sẵn, in JSON', () => {
  const files = ['docs/a.md', 'engine/src/nexgraph_engine/cli.py', ''].join('\n');
  const res = spawnSync(process.execPath, [SCRIPT, '--files', files, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout.trim()), {
    engine: true,
    desktop: false,
    packaging: true,
    ci: false,
  });
});

test('CLI --github-output ghi đủ 4 cờ vào GITHUB_OUTPUT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changed-areas-'));
  const out = join(dir, 'github-output');
  try {
    const res = spawnSync(
      process.execPath,
      [SCRIPT, '--files', ['apps/desktop/src/a.ts', ''].join('\n'), '--github-output'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: out },
      },
    );
    assert.equal(res.status, 0, res.stderr);
    const text = readFileSync(out, 'utf8');
    assert.match(text, /^engine=false$/m);
    assert.match(text, /^desktop=true$/m);
    assert.match(text, /^packaging=true$/m);
    assert.match(text, /^ci=false$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
