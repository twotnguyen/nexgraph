# @nexgraph/contracts

Kiểu và hằng dùng chung giữa main, preload, renderer của app desktop và hợp đồng API v1 của engine. Trước ADR 0026 pha 3, thư mục này là `apps/desktop/src/shared/`.

- Import: `import type { GraphNode } from '@nexgraph/contracts/graph-types'`.
- Không có bước build: `electron.vite.config.ts`, `vitest.config.mts` và `tsconfig.*.json` của app trỏ alias `@nexgraph/contracts` vào `src/`, nên mã được gom vào bundle. Bộ cài không có phụ thuộc lúc chạy vào gói này.
- Luật `contracts-doc-lap` (dependency-cruiser) cấm gói này import mã của main, preload hoặc renderer.
- Kiểm kiểu: `pnpm typecheck` ở gốc repo. Cả hai tsconfig của app đều gồm `packages/contracts/src`.
