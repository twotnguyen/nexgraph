import { app, Notification, type BrowserWindow } from 'electron'

// Giữ tham chiếu tới thông báo đang hiện: bị thu gom rác thì sự kiện click không bao giờ tới.
const live = new Set<Notification>()
let identified = false

/** Thông báo hệ thống khi trợ lý xong lúc cửa sổ không focus (renderer đã quyết định có gửi hay không); bấm vào thì đưa cửa sổ lên. `silent`: âm thanh do cài đặt của app điều khiển, không dùng tiếng của hệ điều hành. */
export function notifyAgent(win: BrowserWindow | null, title: unknown, body: unknown): void {
  if (typeof title !== 'string' || typeof body !== 'string' || !title.trim() || !win || win.isDestroyed() || !Notification.isSupported()) return
  // Windows gắn thông báo với appId của lối tắt do bộ cài tạo (electron-builder.yml); thiếu thì tiêu đề hiện tên Electron.
  if (!identified && process.platform === 'win32') app.setAppUserModelId('io.github.nexgraph.desktop')
  identified = true
  const note = new Notification({ title: title.slice(0, 120), body: body.slice(0, 240), silent: true })
  const done = () => { live.delete(note) }
  note.on('click', () => {
    done()
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  note.on('close', done)
  note.on('failed', done)
  if (live.size >= 20) live.delete(live.values().next().value!)
  live.add(note)
  note.show()
}
