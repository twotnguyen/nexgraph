import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Bundle webview: preload cũ + app React cũ, `electron` trỏ vào lớp nối postMessage.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@nexgraph/contracts': resolve('../../packages/contracts/src'), electron: resolve('src/electron-webview.ts') } },
  worker: { format: 'es' },
  build: {
    outDir: 'dist/webview',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve('src/webview.ts'),
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (a) => (a.names?.[0]?.endsWith('.css') ? 'index.css' : 'assets/[name]-[hash][extname]')
      }
    }
  }
})
