import type { Session } from 'electron'

/**
 * Quyền duy nhất app dùng: ghi clipboard khi người dùng bấm "Sao chép".
 * Chromium tự cấp quyền này cho lần ghi do người dùng khởi phát; mọi quyền khác bị từ chối.
 */
const ALLOWED = new Set(['clipboard-sanitized-write'])

type SessionLike = Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>

/**
 * Chặn mặc định quyền của renderer (REV-17): camera/micro, vị trí, thông báo, USB/serial/HID,
 * fullscreen, pointer lock… Monaco và các panel của NexGraph không cần quyền nào trong số đó,
 * nên từ chối hết thay vì để Electron hỏi hệ điều hành.
 */
export function installPermissionHandlers(session: SessionLike): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED.has(permission))
  })
  session.setPermissionCheckHandler((_contents, permission) => ALLOWED.has(permission))
}
