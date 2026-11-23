import { defineConfig } from '@playwright/test'

/**
 * E2E Electron: mở app thật bằng `_electron.launch` (dùng Electron của apps/desktop, không tải Chromium).
 * Chạy: `pnpm --filter @nexgraph/desktop e2e` (script build trước rồi mới chạy spec).
 *
 * Trace bật cho mọi lượt để lỗi chập chờn còn điều tra được; ảnh từng bước do spec tự chụp
 * (đặt `NEXGRAPH_E2E_SHOTS=<thư mục>` để gom ảnh ra ngoài `test-results/`).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    trace: 'on',
    screenshot: 'off',
    video: 'off'
  }
})
