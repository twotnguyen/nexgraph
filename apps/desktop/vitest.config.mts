import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: { alias: { '@nexgraph/contracts': resolve('../../packages/contracts/src') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.{ts,tsx}', '../../packages/contracts/src/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-tmp.ts']
  }
})
