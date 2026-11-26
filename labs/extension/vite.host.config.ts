import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Bundle extension host: mã main cũ + lớp giả lập `electron`, một file CJS, chỉ để ngoài `vscode`.
export default defineConfig({
  resolve: { alias: { '@nexgraph/contracts': resolve('../../packages/contracts/src'), electron: resolve('src/electron-host.ts') } },
  ssr: { noExternal: true },
  build: {
    ssr: 'src/extension.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: { external: ['vscode'], output: { format: 'cjs', entryFileNames: 'extension.cjs', inlineDynamicImports: true } }
  }
})
