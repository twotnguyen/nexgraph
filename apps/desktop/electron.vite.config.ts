import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

// Hợp đồng kiểu main ↔ preload ↔ renderer ↔ engine (ADR 0026 pha 3): gói `@nexgraph/contracts` trong packages/,
// được gom vào bundle qua alias, không thành phụ thuộc lúc chạy của bộ cài.
const contracts = resolve('../../packages/contracts/src')

export default defineConfig({
  main: {
    resolve: { alias: { '@nexgraph/contracts': contracts } }
  },
  preload: {
    resolve: { alias: { '@nexgraph/contracts': contracts } },
    build: {
      rollupOptions: {
        // Hai preload: `index` cho cửa sổ app, `graphPage` cho khung nhúng `.nexgraph/` (ADR 0024).
        input: { index: resolve('src/preload/index.ts'), graphPage: resolve('src/preload/graph-page.ts') }
      }
    }
  },
  renderer: {
    resolve: {
      alias: [
        { find: '@nexgraph/contracts', replacement: contracts },
        // monaco-vim nhập "monaco-editor/esm/vs/…" nhưng exports của monaco-editor đã tự thêm esm/vs.
        { find: /^monaco-editor\/esm\/vs\/(.*)$/, replacement: 'monaco-editor/$1' }
      ]
    },
    plugins: [react()],
    worker: { format: 'es' }
  }
})
