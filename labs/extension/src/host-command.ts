import type { HostCommand } from '../../../packages/contracts/src/api'

export function parseInitialCommand(raw: string | undefined): HostCommand | undefined {
  if (!raw) return
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string' && value.name) {
      return { name: value.name, ...('arg' in value ? { arg: value.arg } : {}) }
    }
  } catch { /* dữ liệu khởi động không hợp lệ */ }
}

/** Giữ lệnh đến khi webview đăng ký listener đầu tiên, sau đó phát theo thứ tự nhận. */
export function createHostCommandRelay(send: (command: HostCommand) => void) {
  let waiting: HostCommand[] | null = []
  return {
    post(command: HostCommand): void {
      if (waiting) waiting.push(command)
      else send(command)
    },
    ready(): void {
      const commands = waiting
      waiting = null
      commands?.forEach(send)
    }
  }
}
