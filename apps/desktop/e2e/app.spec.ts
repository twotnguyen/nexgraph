import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NexGraphApi } from '../src/shared/api'
import { addDataDirOwner, prepareDataDir } from './data-dir'

/**
 * E2E Electron tối thiểu cho NexGraph (QA-14).
 *
 * Chạy app thật bằng `_electron.launch` trên mã đã build (`electron-vite build` do script `e2e` lo),
 * với `NEXGRAPH_DATA_DIR`/`NEXGRAPH_USER_DATA_DIR` tạm nên không đụng dữ liệu người dùng.
 * Fixture nhỏ tự tạo trong tmp (app.py → service.py → repo.py) để có lời gọi liên tệp, luồng và vùng ảnh hưởng.
 *
 * Kịch bản: mở dự án bằng `window.nexgraph.project.open(path)` → lập chỉ mục qua UI → tìm trong đồ thị
 * → Kiến trúc → Luồng → mở tệp → sửa và lưu trong Monaco → Vùng ảnh hưởng.
 * Mỗi bước kiểm phần tử hiển thị thật (visible + nhãn) và chụp ảnh; đặt `NEXGRAPH_E2E_SHOTS=<dir>` để gom ảnh ra ngoài.
 */

const APP_DIR = join(__dirname, '..')
const PROJECT_NAME = 'ng-e2e-Đồ án'

/** `electron` export đường dẫn binary; cần require vì package.json của desktop không phải ESM. */
const electronPath = require('electron') as string

const FIXTURE: Record<string, string> = {
  'app.py': ['"""Điểm vào mẫu cho E2E."""', 'from service import login_user', '', '', 'def main():', '    return login_user("an")', ''].join('\n'),
  'service.py': ['"""Nghiệp vụ đăng nhập."""', 'from repo import find_user', '', '', 'def login_user(body):', '    user = find_user(body)', '    return user', ''].join('\n'),
  'repo.py': ['"""Truy cập dữ liệu."""', '', '', 'def find_user(body):', '    return {"name": body}', ''].join('\n')
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const dir = process.env.NEXGRAPH_E2E_SHOTS
  if (dir) mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: dir ? join(dir, `${name}.png`) : testInfo.outputPath(`${name}.png`) })
}

async function closeApp(app: ElectronApplication): Promise<void> {
  // App chặn thoát cho tới khi engine dừng hẳn; quá 15 s thì kill để không treo lượt chạy.
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 15_000))])
  if (child && child.exitCode === null) child.kill('SIGKILL')
}

/** PYTHONPATH/PYTHONHOME của shell ngoài (agent, venv khác) làm engine chọn nhầm pydantic_core; bỏ trước khi spawn. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.PYTHONPATH
  delete env.PYTHONHOME
  return env
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright bắt buộc tham số đầu là object destructuring; spec không dùng fixture nào.
test('mở dự án → index → tìm → Kiến trúc → Luồng → mở tệp → sửa → vùng ảnh hưởng', async ({}, testInfo) => {
  const root = mkdtempSync(join(tmpdir(), 'ng-e2e-'))
  const projectDir = join(root, PROJECT_NAME)
  mkdirSync(projectDir)
  // macOS: /var → /private/var, app lưu đường dẫn thật.
  const projectPath = realpathSync(projectDir)
  for (const [name, text] of Object.entries(FIXTURE)) writeFileSync(join(projectDir, name), text)

  // `NEXGRAPH_E2E_DATA_DIR` cho phép dùng lại một thư mục giữa các lượt: dọn sạch đầu mỗi lượt để lượt sau
  // giống hệt lượt đầu. Không dọn thì dự án cũ còn trong kho engine, app mở ở “Chào mừng trở lại NexGraph”
  // và assert heading dưới đỏ ngay lượt thứ 2. Lưu ý: thư mục này **bị xoá mỗi lượt**, chỉ dùng cho E2E;
  // `prepareDataDir` từ chối xoá thư mục ngoài tmpdir khi không có marker do chính E2E tạo (e2e/data-dir.ts).
  const engineDataDir = process.env.NEXGRAPH_E2E_DATA_DIR ?? join(root, 'engine-data')
  await prepareDataDir(engineDataDir, { pids: [process.pid] })

  const app = await electron.launch({
    executablePath: electronPath,
    args: [APP_DIR],
    timeout: 90_000,
    env: {
      ...cleanEnv(),
      NEXGRAPH_DATA_DIR: engineDataDir,
      NEXGRAPH_USER_DATA_DIR: join(root, 'user-data')
    }
  })

  // Ghi PID Electron vào marker: lượt sau chờ cả cây engine của lượt này thoát trước khi xoá dữ liệu.
  const appPid = app.process().pid
  if (appPid !== undefined) addDataDirOwner(engineDataDir, appPid)

  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(30_000)
    await page.waitForLoadState('domcontentloaded')

    // 0. Engine sidecar (uv run) sẵn sàng trước khi mở dự án.
    await expect
      .poll(
        () => page.evaluate(async () => (window as unknown as { nexgraph: NexGraphApi }).nexgraph.engine.status().then((s) => s.state)),
        { timeout: 120_000, intervals: [500] }
      )
      .toBe('ready')
    await expect(page.getByRole('heading', { name: 'Chào mừng đến NexGraph' })).toBeVisible()
    await shot(page, testInfo, '01-projects')

    // 1. Mở dự án bằng API (bỏ qua hộp thoại native), rồi để UI tự hiện dự án trong danh sách.
    const project = await page.evaluate(
      (path) => (window as unknown as { nexgraph: NexGraphApi }).nexgraph.project.open(path),
      projectDir
    )
    expect(project.name).toBe(PROJECT_NAME)
    expect(project.path).toBe(projectPath)
    await page.reload()
    const recent = page.locator('.recent-open', { hasText: PROJECT_NAME })
    await expect(recent).toBeVisible()
    await expect(recent).toContainText(projectPath)
    await shot(page, testInfo, '02-recent-project')

    // 2. Mở dự án từ danh sách → lập chỉ mục thật qua UI (màn Tiến độ) → Bắt đầu khám phá.
    await recent.click()
    await expect(page.getByRole('heading', { name: `Đã lập chỉ mục: ${PROJECT_NAME}` })).toBeVisible({ timeout: 180_000 })
    const explore = page.getByRole('button', { name: 'Bắt đầu khám phá' })
    await expect(explore).toBeEnabled()
    await shot(page, testInfo, '03-index-done')
    await explore.click()

    // 3. Không gian làm việc: đủ thẻ, Kiến trúc vẽ node.
    await expect(page.getByRole('tablist', { name: 'Các thẻ không gian làm việc' })).toBeVisible()
    for (const label of ['Kiến trúc', 'Bản đồ', 'Luồng', 'Graph', 'Cây', 'Báo cáo']) {
      await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible()
    }
    const archNodes = page.locator('.arch-canvas .react-flow__node')
    await expect(archNodes.first()).toBeVisible()
    expect((await archNodes.first().innerText()).trim().length).toBeGreaterThan(0)
    await shot(page, testInfo, '04-workspace-arch')

    // 4. Tìm trong đồ thị: gõ từ khoá, thấy đúng symbol kèm tệp.
    await page.locator('.activity-bar button[aria-label="Tìm trong đồ thị"]').click()
    const searchInput = page.locator('input[aria-label="Tìm trong đồ thị"]')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('login_user')
    const hit = page.locator('.ws-tools-search .search-results li button').first()
    await expect(hit).toBeVisible({ timeout: 60_000 })
    await expect(hit).toContainText('login_user')
    await expect(hit).toContainText('service.py')
    await shot(page, testInfo, '05-search')

    // 5. Kiến trúc: thẻ đang chọn, canvas có node.
    await page.getByRole('tab', { name: 'Kiến trúc', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Kiến trúc', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(archNodes.first()).toBeVisible()
    await shot(page, testInfo, '06-arch')

    // 6. Luồng: có luồng từ main(), mở luồng thấy các bước.
    await page.getByRole('tab', { name: 'Luồng', exact: true }).click()
    await expect(page.locator('.flows-view')).toBeVisible()
    const flowCard = page.locator('.flow-card').first()
    await expect(flowCard).toBeVisible({ timeout: 60_000 })
    await expect(flowCard.locator('.flow-card-title')).toContainText('main')
    await flowCard.click()
    await expect(page.locator('.step-row').first()).toBeVisible()
    await expect(page.locator('.step-name').first()).toContainText('main')
    await shot(page, testInfo, '07-flows')

    // 7. Mở tệp từ cây tệp: tab tệp + Monaco hiện nội dung.
    await page.locator('.activity-bar button[aria-label="Duyệt tệp"]').click()
    await expect(page.locator('.ws-tools-explorer')).toBeVisible()
    const serviceRow = page.locator('.ws-tools-explorer .tree-row[aria-label="service.py"]')
    await expect(serviceRow).toBeVisible()
    await serviceRow.click()
    // Bấm một lần trong cây tệp mở thẻ xem trước; thẻ tệp đã mở trước đó vẫn còn nên chọn thẻ đang chọn.
    const openTab = page.locator('.tabs .tab-name[title="service.py"]').last()
    await expect(openTab).toBeVisible()
    await expect(openTab).toHaveAttribute('aria-selected', 'true')
    const editor = page.locator('.monaco-editor').first()
    await expect(editor).toBeVisible()
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('login_user')
    await shot(page, testInfo, '08-file-open')

    // 8. Sửa trong Monaco: gõ thêm dòng, thấy “Chưa lưu”, lưu bằng Cmd+S, đĩa nhận nội dung mới.
    await editor.click()
    await page.keyboard.type('# e2e-edit-marker')
    await expect(page.getByRole('status').filter({ hasText: 'Chưa lưu' })).toBeVisible()
    await shot(page, testInfo, '09-edited')
    await page.keyboard.press('Meta+s')
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible({ timeout: 30_000 })
    expect(readFileSync(join(projectDir, 'service.py'), 'utf8')).toContain('e2e-edit-marker')
    await shot(page, testInfo, '10-saved')

    // 9. Vùng ảnh hưởng: tệp vừa sửa hiện trong “Đã thay đổi”, caller main() nằm trong “Vùng ảnh hưởng”.
    await page.locator('.activity-bar button[aria-label="Vùng ảnh hưởng"]').click()
    const changes = page.locator('.ws-tools-changes')
    await expect(changes).toBeVisible()
    await changes.getByRole('button', { name: 'Làm mới' }).click()
    await expect(changes.getByRole('region', { name: 'Đã thay đổi' })).toContainText('service.py', { timeout: 60_000 })
    const impact = changes.getByRole('region', { name: 'Vùng ảnh hưởng' })
    await expect(impact).toContainText('main', { timeout: 60_000 })
    await shot(page, testInfo, '11-changes')
  } finally {
    await closeApp(app)
    rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  }
})
