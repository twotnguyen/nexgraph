/**
 * Luật phụ thuộc giữa các khối của app desktop (ADR 0026, pha 0: chỉ báo cáo).
 * Chạy: `pnpm rules:report` ở gốc repo. Pha 2–3 sẽ thêm luật theo `features/<x>`.
 */
const TEST = '(\\.test\\.[cm]?tsx?$|^test/|^e2e/|test-utils\\.ts$)'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'renderer-khong-import-main',
      comment: 'Renderer chỉ nói chuyện với main qua preload/IPC; kiểu dùng chung để ở @nexgraph/contracts. Test tích hợp được miễn.',
      severity: 'error',
      from: { path: '^src/renderer/', pathNot: TEST },
      to: { path: '^src/main/' },
    },
    {
      name: 'main-khong-import-renderer',
      severity: 'error',
      from: { path: '^src/main/', pathNot: TEST },
      to: { path: '^src/renderer/' },
    },
    {
      name: 'preload-chi-dung-shared',
      comment: 'Preload là cầu nối mỏng: chỉ dùng @nexgraph/contracts.',
      severity: 'error',
      from: { path: '^src/preload/' },
      to: { path: '^src/(main|renderer)/' },
    },
    {
      name: 'contracts-doc-lap',
      comment: 'packages/contracts là hợp đồng (ADR 0026 pha 3, trước là src/shared): không phụ thuộc main/renderer/preload.',
      severity: 'error',
      from: { path: '(^|/)packages/contracts/' },
      to: { path: '^src/(main|renderer|preload)/' },
    },
    {
      name: 'state-khong-import-components',
      comment: 'State/hook của renderer không phụ thuộc component; component dùng state, không ngược lại.',
      severity: 'error',
      from: { path: '^src/renderer/src/state/', pathNot: TEST },
      to: { path: '^src/renderer/src/components/' },
    },
    {
      name: 'ma-san-pham-khong-import-test',
      severity: 'error',
      from: { path: '^src/', pathNot: TEST },
      to: { path: TEST },
    },
    {
      name: 'khong-vong-phu-thuoc',
      comment: 'Vòng import giữa các tệp mã sản phẩm.',
      severity: 'warn',
      from: { path: '^src/', pathNot: TEST },
      to: { circular: true, pathNot: TEST },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|out|dist)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.node.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json'] },
  },
}
