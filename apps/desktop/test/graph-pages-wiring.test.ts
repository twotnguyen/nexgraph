// NG-UI-1: nối protocol vào session giả (install + will-attach-webview).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  PAGES_PARTITION, attachGraphPageWebview, installGraphPagesProtocol, pageUrl, projectFromPageUrl
} from '../src/main/graph-pages/protocol'

vi.mock('electron', () => ({ protocol: { registerSchemesAsPrivileged: vi.fn() } }))

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ng-wire-'))
  const dir = join(root, '.nexgraph')
  mkdirSync(dir)
  writeFileSync(join(dir, 'graph.html'), '<html><head><title>graphify - graphify-out/graph.html</title></head><body></body></html>')
  return root
}

const libsDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ng-wire-libs-'))
  writeFileSync(join(dir, 'vis-network-9.1.6.min.js'), '/* vis */')
  writeFileSync(join(dir, 'd3.v7.min.js'), '/* d3 */')
  writeFileSync(join(dir, 'mermaid-11.min.js'), '/* mermaid */')
  return dir
}

const fakeSession = () => {
  const handlers = new Map<string, (request: Request) => Promise<Response>>()
  const state: { before?: (details: { url: string }, done: (r: { cancel?: boolean }) => void) => void; permissions: boolean[] } = { permissions: [] }
  const ses = {
    protocol: { handle: (scheme: string, handler: (request: Request) => Promise<Response>) => { handlers.set(scheme, handler) } },
    webRequest: { onBeforeRequest: (cb: (details: { url: string }, done: (r: { cancel?: boolean }) => void) => void) => { state.before = cb } },
    setPermissionRequestHandler: (cb: (c: unknown, p: string, done: (granted: boolean) => void) => void) => { cb({}, 'media', (v) => state.permissions.push(v)) },
    setPermissionCheckHandler: (cb: () => boolean) => { state.permissions.push(cb()) },
    on: () => {}
  }
  return { ses, handlers, state }
}

describe('gắn protocol vào session của partition', () => {
  it('phục vụ trang qua scheme và chặn https lạ', async () => {
    const root = fixture()
    const { ses, handlers, state } = fakeSession()
    installGraphPagesProtocol(ses as never, { roots: new Map([['pid-1', root]]), libsDir: libsDir() })
    const page = await handlers.get('nxpage')!(new Request(pageUrl('pid-1', 'graph.html')))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<title>NexGraph - .nexgraph/graph.html</title>')
    expect((await handlers.get('https')!(new Request('https://example.com/x.js'))).status).toBe(403)
    expect((await handlers.get('https')!(new Request('https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js'))).status).toBe(200)
    expect((await handlers.get('http')!(new Request('http://127.0.0.1/x'))).status).toBe(403)
    let cancelled: { cancel?: boolean } | null = null
    state.before!({ url: 'https://example.com/track.js' }, (r) => { cancelled = r })
    expect(cancelled).toEqual({ cancel: true })
    cancelled = null
    state.before!({ url: 'nxpage://pid-1/graph.html' }, (r) => { cancelled = r })
    expect(cancelled).toEqual({})
    expect(state.permissions).toEqual([false, false])
  })

  it('URL trang mang đúng projectId', () => {
    expect(projectFromPageUrl(pageUrl('abc', 'GRAPH_TREE.html'))).toBe('abc')
    expect(projectFromPageUrl('https://example.com/x')).toBeNull()
    expect(projectFromPageUrl('nxpage:///x')).toBeNull()
  })
})

describe('chỉ khung nhúng của tính năng được gắn vào cửa sổ', () => {
  // Dựng bằng API native: Windows trả `C:\…` và `file:///C:/…`, không phải chuỗi POSIX.
  const preloadPath = join(tmpdir(), 'ng-preload', 'graphPage.js')
  const expected = { preloadUrl: pathToFileURL(preloadPath).toString() }
  const okParams = { partition: PAGES_PARTITION, src: pageUrl('pid-1', 'graph.html') }

  it('chấp nhận đúng partition/src/preload và ép sandbox', () => {
    const event = { preventDefault: vi.fn() }
    const prefs = { preload: expected.preloadUrl, nodeIntegration: false, contextIsolation: true, sandbox: true }
    attachGraphPageWebview(event, prefs, okParams, expected)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(prefs).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true })
  })

  it('chấp nhận preload dạng đường dẫn tuyệt đối (Electron chuẩn hoá từ file:// URL)', () => {
    const event = { preventDefault: vi.fn() }
    const prefs = { preload: preloadPath }
    attachGraphPageWebview(event, prefs, okParams, expected)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(prefs).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true })
  })

  it('chặn partition lạ, src lạ và preload lạ', () => {
    for (const params of [{ ...okParams, partition: 'persist:x' }, { ...okParams, src: 'https://example.com' }, { partition: PAGES_PARTITION }]) {
      const event = { preventDefault: vi.fn() }
      attachGraphPageWebview(event, { preload: expected.preloadUrl }, params as never, expected)
      expect(event.preventDefault).toHaveBeenCalled()
    }
    const event = { preventDefault: vi.fn() }
    attachGraphPageWebview(event, { preload: pathToFileURL(join(tmpdir(), 'ng-evil', 'evil.js')).toString() }, okParams, expected)
    expect(event.preventDefault).toHaveBeenCalled()
  })
})
