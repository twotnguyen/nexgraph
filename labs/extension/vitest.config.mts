import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  // `vscode` chỉ có trong extension host: test dùng bản giả.
  resolve: { alias: { vscode: resolve('test/vscode-stub.ts') } },
  test: { environment: 'node', include: ['test/**/*.test.ts'] }
})
