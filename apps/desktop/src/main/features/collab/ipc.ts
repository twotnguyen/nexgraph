import type { CollabHello } from '@nexgraph/contracts/api'
import { CollabHub } from './hub'
import { FsError } from '../../platform/project-fs'
import type { IpcContext } from '../../platform/ipc-context'

let collab: CollabHub | null = null

/** Đóng phiên cộng tác khi thoát app. */
export const stopCollab = (): void => { collab?.stop() }

/** Cộng tác LAN: main chỉ mở/nối WebSocket và chuyển tiếp gói nhị phân giữa renderer và các máy khác. */
export function registerCollabIpc(ctx: IpcContext): void {
  const { on, getWindow } = ctx
  collab = new CollabHub((event) => getWindow()?.webContents.send('collab:event', event))
  const hub = collab
  on('collab:host', async (hello: CollabHello) => {
    if (!hello || typeof hello.file !== 'string' || typeof hello.host !== 'string') throw new FsError('bad_param', 'Thiếu tên tệp chia sẻ')
    return hub.host({ file: hello.file.slice(0, 500), host: hello.host.slice(0, 80) })
  })
  on('collab:join', async (address: string, code: string) => hub.join(String(address), String(code)))
  on('collab:send', async (data: Uint8Array) => { if (data instanceof Uint8Array) hub.send(data) })
  on('collab:stop', async () => hub.stop())
}
