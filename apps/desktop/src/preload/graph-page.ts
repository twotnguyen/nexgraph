/// <reference lib="dom" />
// Preload của khung nhúng các trang trong `.nexgraph/` (ADR 0024).
// Chạy trong isolated world của trang; nói chuyện với main world qua postMessage vì
// `network`/`nodesDS` của graph.html là khai báo top-level, không phải thuộc tính window.
import { ipcRenderer, webFrame } from 'electron'
import { GRAPH_PAGE_NODE_CHANNEL, GRAPH_PAGE_THEME_CHANNEL } from '../shared/graph-pages'

export const PAGE_NODE_CHANNEL = GRAPH_PAGE_NODE_CHANNEL
export const PAGE_THEME_CHANNEL = GRAPH_PAGE_THEME_CHANNEL

const fileName = (): string => {
  try {
    return decodeURIComponent(location.pathname.replace(/^\/+/, ''))
  } catch {
    return ''
  }
}
const PAGE = fileName()
const KIND: 'graph' | 'tree' | 'callflow' | 'other' =
  PAGE === 'graph.html' ? 'graph' : PAGE === 'GRAPH_TREE.html' ? 'tree' : PAGE.endsWith('-callflow.html') ? 'callflow' : 'other'

/** Bọc `showInfo` — vis-network 9.1.6 không phát `selectNode` khi `selectNodes()` (spike A3 §3.3). */
const BRIDGE = `(function () {
  if (window.__nxBridge) return 'ok';
  if (typeof network === 'undefined') return 'no-network-yet';
  function send(id, via) {
    var n = null;
    try { n = (typeof nodesDS !== 'undefined') ? nodesDS.get(id) : null; } catch (e) {}
    window.postMessage({ __nx: true, kind: 'node', via: via, id: String(id),
      label: n ? n.label : null, source_file: n ? n.source_file : null,
      source_location: n ? (n.source_location || null) : null, tab: ${JSON.stringify(KIND)} }, '*');
  }
  var orig = window.showInfo;
  if (typeof orig === 'function' && !window.__nxOrigShowInfo) {
    window.__nxOrigShowInfo = orig;
    window.showInfo = function (id) {
      var r = orig.apply(this, arguments);
      try { send(id, 'showInfo'); } catch (e) {}
      return r;
    };
  }
  network.on('click', function (p) { p.nodes.forEach(function (id) { send(id, 'canvas-click'); }); });
  window.__nxBridge = { send: send, hooked: typeof orig === 'function' };
  return 'ok';
})()`

async function installBridge(): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    try {
      if (await webFrame.executeJavaScript(BRIDGE) === 'ok') return true
    } catch {
      // Trang còn đang parse.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

let lastId = ''
let lastAt = 0
function onNode(data: { id: string; label?: string | null; source_file?: string | null; source_location?: string | null; via?: string | null }): void {
  const now = Date.now()
  // Một cú bấm đi qua cả showInfo lẫn network click → gửi hai lần.
  if (data.id === lastId && now - lastAt < 250) return
  lastId = data.id
  lastAt = now
  ipcRenderer.send(PAGE_NODE_CHANNEL, {
    id: data.id, label: data.label ?? null, source_file: data.source_file ?? null,
    source_location: data.source_location ?? null, via: data.via ?? null, tab: KIND
  })
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data as { __nx?: boolean; kind?: string } | null
  if (!data || data.__nx !== true || data.kind !== 'node') return
  onNode(data as { id: string })
})

// Đường chọn nút không đi qua showInfo: đọc lại lựa chọn của vis sau click.
document.addEventListener('click', (event) => {
  const target = event.target as Element | null
  if (!target?.closest?.('#graph, #search-results, .neighbor-link')) return
  setTimeout(() => {
    void webFrame.executeJavaScript('typeof network !== "undefined" ? JSON.stringify(network.getSelectedNodes()) : "[]"')
      .then((ids: string) => {
        for (const id of JSON.parse(ids || '[]') as string[]) {
          void webFrame.executeJavaScript(`window.__nxBridge && window.__nxBridge.send(${JSON.stringify(id)}, 'click-fallback')`)
        }
      })
      .catch(() => {})
  }, 80)
}, true)

// GRAPH_TREE.html và trang callflow không có theme: app bơm CSS tối/sáng (vá phía NexGraph).
const THEME_CSS = `
html.nx-dark { background: #0d1117 !important; }
html.nx-dark body { background: #0d1117 !important; color: #d7dde5 !important; }
html.nx-dark h1, html.nx-dark h2, html.nx-dark h3 { color: #e6edf3 !important; background: none !important; -webkit-text-fill-color: currentColor !important; }
html.nx-dark .controls button, html.nx-dark .mermaid-toolbar button { background:#1e293b !important; color:#e6edf3 !important; border-color:#334155 !important; }
html.nx-dark #tree-container, html.nx-dark .container, html.nx-dark .card, html.nx-dark #tree-svg { background:#0d1117 !important; color:#d7dde5 !important; }
html.nx-dark .link { stroke:#3b4a63 !important; }
html.nx-dark .node circle { fill:#111a2e !important; stroke:#4da3ff !important; }
html.nx-dark .node text, html.nx-dark text { fill:#d7dde5 !important; }
html.nx-light body { background:#f7f8fa !important; color:#111827 !important; }
`

function applyTheme(pref: unknown): void {
  const value = pref === 'light' ? 'light' : 'dark'
  if (KIND === 'graph') {
    try {
      localStorage.setItem('graphify-theme', value)
    } catch {
      // Trang vẫn đổi theme trong phiên dù không lưu được.
    }
    void webFrame.executeJavaScript(`(function(){try{applyTheme(${JSON.stringify(value)});}catch(e){}return document.documentElement.getAttribute('data-theme')})()`).catch(() => {})
    return
  }
  let style = document.getElementById('nx-theme')
  if (!style) {
    style = document.createElement('style')
    style.id = 'nx-theme'
    style.textContent = THEME_CSS
    document.head.appendChild(style)
  }
  const classes = document.documentElement.classList
  classes.toggle('nx-dark', value === 'dark')
  classes.toggle('nx-light', value === 'light')
}

ipcRenderer.on(PAGE_THEME_CHANNEL, (_event, pref: unknown) => applyTheme(pref))

window.addEventListener('DOMContentLoaded', () => {
  if (KIND === 'graph') {
    void installBridge().then((ok) => ipcRenderer.send(PAGE_NODE_CHANNEL, { id: '__bridge__', bridge: ok, tab: KIND, via: 'boot' }))
  } else {
    ipcRenderer.send(PAGE_NODE_CHANNEL, { id: '__boot__', tab: KIND, via: 'boot' })
  }
})
