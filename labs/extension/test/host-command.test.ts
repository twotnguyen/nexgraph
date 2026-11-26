import { describe, expect, it } from 'vitest'
import { createHostCommandRelay, parseInitialCommand } from '../src/host-command'
import type { HostCommand } from '../../../apps/desktop/src/shared/api'

describe('lệnh Code-OSS khi mở tab NexGraph', () => {
  it('giữ lệnh mở công cụ và dữ liệu đi kèm khi khởi động', () => {
    const command: HostCommand = { name: 'highlight', arg: { notice: 'Đồ án <mẫu> "A"', nodes: [], edges: [] } }
    expect(parseInitialCommand(JSON.stringify(command))).toEqual(command)
    expect(parseInitialCommand('{"name":"settings"}')).toEqual({ name: 'settings' })
    expect(parseInitialCommand('{"name":"panel:search"}')).toEqual({ name: 'panel:search' })
    expect(parseInitialCommand('{"name":"export"}')).toEqual({ name: 'export' })
    expect(parseInitialCommand('{"name":17}')).toBeUndefined()
    expect(parseInitialCommand('{')).toBeUndefined()
  })

  it('phát lệnh đến trong lúc webview nạp theo thứ tự, đúng một lần', () => {
    const sent: HostCommand[] = []
    const relay = createHostCommandRelay((command) => sent.push(command))
    relay.post({ name: 'panel:search' })
    relay.post({ name: 'panel:changes' })
    expect(sent).toEqual([])
    relay.ready()
    relay.ready()
    relay.post({ name: 'view:flows' })
    expect(sent.map((command) => command.name)).toEqual(['panel:search', 'panel:changes', 'view:flows'])
  })
})
