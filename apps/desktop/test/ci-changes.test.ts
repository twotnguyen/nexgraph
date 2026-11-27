import { describe, expect, it } from 'vitest'
import { ALL, classify } from '../../../tools/ci/changes.mjs'

describe('tools/ci/changes.mjs: chọn phần CI cần chạy theo tệp đổi của PR', () => {
  it('danh sách rỗng hoặc không lấy được danh sách: chạy tất cả (an toàn hơn bỏ sót)', () => {
    expect(classify([])).toEqual(ALL)
    expect(classify(null)).toEqual(ALL)
  })

  it('đổi workflow hoặc script CI: chạy tất cả', () => {
    expect(classify(['.github/workflows/ci.yml'])).toEqual(ALL)
    expect(classify(['tools/ci/changes.mjs', 'docs/a.md'])).toEqual(ALL)
  })

  it('chỉ tài liệu: không test desktop, không đóng gói; engine chỉ chạy nhóm test đọc tài liệu', () => {
    expect(classify(['docs/srs.md', 'README.md', 'engine/README.md'])).toEqual({ engine: 'docs', desktop: false, package: false, labs: false })
  })

  it('design/database/*.sql là đầu vào của test schema engine: engine chạy đủ', () => {
    expect(classify(['design/database/graph-v7.sql']).engine).toBe('full')
  })

  it('ảnh trong docs/ và design/ là đầu vào test desktop (agent-images): chỉ chạy desktop', () => {
    for (const file of ['design/logo/nexgraph-dag-logo.webp', 'docs/release/acceptance/windows-nestjs-index.jpg']) {
      expect(classify([file]), file).toEqual({ engine: 'skip', desktop: true, package: false, labs: false })
    }
  })

  it('chỉ renderer: không chạy test engine, không đóng gói; vẫn test desktop và labs', () => {
    expect(classify(['apps/desktop/src/renderer/src/features/agent/ApprovalCard.tsx']))
      .toEqual({ engine: 'skip', desktop: true, package: false, labs: true })
  })

  it('main process hoặc preload: đóng gói chạy (đường dẫn tài nguyên, binary đi kèm)', () => {
    expect(classify(['apps/desktop/src/main/features/agent/nex/sidecar.ts'])).toMatchObject({ engine: 'skip', desktop: true, package: true })
    expect(classify(['apps/desktop/src/preload/index.ts']).package).toBe(true)
  })

  it('chỉ test desktop: không đóng gói, không test engine', () => {
    expect(classify(['apps/desktop/test/nex-config.test.ts', 'apps/desktop/src/renderer/src/a.test.tsx']))
      .toEqual({ engine: 'skip', desktop: true, package: false, labs: false })
  })

  it('package.json của desktop là nguồn version mà test engine đọc: engine chạy đủ', () => {
    expect(classify(['apps/desktop/package.json'])).toMatchObject({ engine: 'full', desktop: true, package: true })
  })

  it('mã engine: chạy đủ engine, desktop (E2E dùng engine thật) và đóng gói (PyInstaller)', () => {
    expect(classify(['engine/src/nexgraph_engine/interfaces/mcp/server.py'])).toEqual({ engine: 'full', desktop: true, package: true, labs: false })
  })

  it('test engine: không đóng gói, không test desktop; trừ fixture mà E2E desktop dùng', () => {
    expect(classify(['engine/tests/interfaces/test_mcp.py'])).toEqual({ engine: 'full', desktop: false, package: false, labs: false })
    expect(classify(['engine/tests/fixtures/flow_app/app.py'])).toMatchObject({ engine: 'full', desktop: true, package: false })
  })

  it('tệp đi kèm bộ cài (giấy phép) không bị coi là tài liệu', () => {
    for (const file of ['THIRD_PARTY_LICENSES.md', 'NOTICE', 'LICENSE']) expect(classify([file]).package, file).toBe(true)
  })

  it('chỉ labs: chỉ chạy labs', () => {
    expect(classify(['labs/extension/src/a.ts'])).toEqual({ engine: 'skip', desktop: false, package: false, labs: true })
  })

  it('đường dẫn lạ (thư mục mới, examples/) rơi về chạy đủ', () => {
    expect(classify(['examples/demo/main.dart'])).toEqual(ALL)
    expect(classify(['newdir/x.txt'])).toEqual(ALL)
  })

  it('PR nhiều loại tệp lấy hợp của từng loại', () => {
    expect(classify(['docs/a.md', 'apps/desktop/src/renderer/src/a.tsx'])).toEqual({ engine: 'docs', desktop: true, package: false, labs: true })
  })
})
