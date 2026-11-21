import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: [
        { find: '@shared', replacement: resolve('src/shared') },
        // monaco-vim nhập "monaco-editor/esm/vs/…" nhưng exports của monaco-editor đã tự thêm esm/vs.
        { find: /^monaco-editor\/esm\/vs\/(.*)$/, replacement: 'monaco-editor/$1' }
      ]
    },
    plugins: [react()],
    worker: { format: 'es' }
  }
})
