// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertsFor, announceAgent, getNotifyPrefs, parseNotifyPrefs, setNotifyPrefs } from './agentNotify'

const KEY = 'nexgraph.agent.notify'

class FakeAudio {
  static created: FakeAudio[] = []
  currentTime = 0
  destination = {}
  tones: number[] = []
  closed = false
  constructor() { FakeAudio.created.push(this) }
  createOscillator() {
    const tones = this.tones
    return { frequency: { set value(hz: number) { tones.push(hz) } }, connect: (next: unknown) => next, start: vi.fn(), stop: vi.fn() }
  }
  createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (next: unknown) => next } }
  close() { this.closed = true; return Promise.resolve() }
}

const notify = vi.fn(async (_title: string, _body: string) => {})
const useAgentApi = (agent: object) => { Object.assign(window, { nexgraph: { agent } }) }
beforeEach(() => {
  localStorage.clear()
  setNotifyPrefs({ notify: true, sound: false })
  notify.mockClear()
  FakeAudio.created = []
  vi.stubGlobal('AudioContext', FakeAudio)
  useAgentApi({ notify })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('cài đặt thông báo', () => {
  it('mặc định bật thông báo, tắt âm thanh; giá trị lạ về mặc định, giá trị hợp lệ được giữ riêng từng cái', () => {
    expect(parseNotifyPrefs(null)).toEqual({ notify: true, sound: false })
    expect(parseNotifyPrefs('{hỏng')).toEqual({ notify: true, sound: false })
    expect(parseNotifyPrefs('{"notify":"yes","sound":1}')).toEqual({ notify: true, sound: false })
    expect(parseNotifyPrefs('{"sound":true}')).toEqual({ notify: true, sound: true })
    expect(parseNotifyPrefs('{"notify":false}')).toEqual({ notify: false, sound: false })
  })

  it('đổi một cài đặt không làm mất cái kia và còn sau khi khởi động lại', async () => {
    setNotifyPrefs({ sound: true })
    setNotifyPrefs({ notify: false })
    expect(getNotifyPrefs()).toEqual({ notify: false, sound: true })
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ notify: false, sound: true })
    vi.resetModules() // nạp lại module = khởi động lại app: nó phải đọc lại từ localStorage
    const reopened = await import('./agentNotify')
    expect(reopened.getNotifyPrefs()).toEqual({ notify: false, sound: true })
  })
})

describe('điều kiện báo', () => {
  it('cửa sổ đang được chọn thì không báo gì, dù cài đặt bật hết', () => {
    expect(alertsFor({ notify: true, sound: true }, true)).toEqual({ notify: false, sound: false })
  })

  it('cửa sổ không được chọn thì theo đúng từng cài đặt', () => {
    expect(alertsFor({ notify: true, sound: false }, false)).toEqual({ notify: true, sound: false })
    expect(alertsFor({ notify: false, sound: true }, false)).toEqual({ notify: false, sound: true })
  })
})

describe('announceAgent', () => {
  it('đang ở trong cửa sổ thì không thông báo và không phát tiếng', () => {
    setNotifyPrefs({ notify: true, sound: true })
    announceAgent('done', 'Phiên A', true)
    expect(notify).not.toHaveBeenCalled()
    expect(FakeAudio.created).toHaveLength(0)
  })

  it('đang ở app khác với cài đặt mặc định: có thông báo theo từng loại, không có tiếng', () => {
    announceAgent('done', 'Phiên A', false)
    announceAgent('error', 'Phiên A', false)
    announceAgent('approval', 'Phiên A', false)
    expect(notify.mock.calls).toEqual([
      ['Phiên A', 'Trợ lý đã trả lời xong'],
      ['Phiên A', 'Trợ lý gặp lỗi'],
      ['Phiên A', 'Trợ lý đang chờ bạn duyệt thay đổi']
    ])
    expect(FakeAudio.created).toHaveLength(0)
  })

  it('tắt thông báo, bật âm thanh: chỉ có tiếng, mỗi loại một giai điệu, rồi đóng bộ phát', () => {
    vi.useFakeTimers()
    setNotifyPrefs({ notify: false, sound: true })
    announceAgent('done', 'Phiên A', false)
    announceAgent('error', 'Phiên A', false)
    announceAgent('approval', 'Phiên A', false)
    expect(notify).not.toHaveBeenCalled()
    expect(FakeAudio.created.map((audio) => audio.tones)).toEqual([[660, 880], [330, 247], [740, 740]])
    vi.advanceTimersByTime(1000)
    expect(FakeAudio.created.every((audio) => audio.closed)).toBe(true)
  })

  it('tắt cả hai thì im lặng', () => {
    setNotifyPrefs({ notify: false, sound: false })
    announceAgent('done', 'Phiên A', false)
    expect(notify).not.toHaveBeenCalled()
    expect(FakeAudio.created).toHaveLength(0)
  })

  it('tiêu đề trống lấy tên ứng dụng', () => {
    announceAgent('done', '   ', false)
    expect(notify).toHaveBeenCalledWith('NexGraph', 'Trợ lý đã trả lời xong')
  })

  it('host không có thông báo hoặc môi trường không có Web Audio thì không ném lỗi', () => {
    setNotifyPrefs({ notify: true, sound: true })
    vi.stubGlobal('AudioContext', undefined)
    useAgentApi({})
    expect(() => announceAgent('done', 'A', false)).not.toThrow()
  })
})
