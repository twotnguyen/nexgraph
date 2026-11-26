/**
 * Luật phụ thuộc giữa các khối của app desktop (ADR 0026). Từ pha 4e là check bắt buộc `module-rules` (`pnpm rules:strict`).
 * Chạy: `pnpm rules:report` ở gốc repo. Renderer: app → features → shared/i18n (pha 3b).
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
      name: 'renderer-shared-doc-lap',
      comment: 'renderer/src/shared (ui, lib) và i18n dùng được ở mọi nơi nên không phụ thuộc tính năng hay phần lắp ráp (ADR 0026 pha 3b; trước là state-khong-import-components).',
      severity: 'error',
      from: { path: '^src/renderer/src/(shared|i18n)/', pathNot: TEST },
      to: { path: '^src/renderer/src/(app|features)/' },
    },
    {
      name: 'features-khong-import-app',
      comment: 'Tính năng không phụ thuộc phần lắp ráp workbench (app/); app/ ghép các tính năng lại.',
      severity: 'error',
      from: { path: '^src/renderer/src/features/', pathNot: TEST },
      to: { path: '^src/renderer/src/app/' },
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
