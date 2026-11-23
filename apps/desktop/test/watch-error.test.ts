import { describe, expect, it } from 'vitest'
import { WatchErrorNotifier, WATCH_ERROR_REPEAT_MS } from '../src/main/watch/error-notice'

const setup = () => {
  let clock = 1_000_000
  const sent: { projectId: string; message: string }[] = []
  const notifier = new WatchErrorNotifier((failure) => sent.push(failure), () => {}, () => clock)
  return { sent, notifier, advance: (ms: number) => { clock += ms } }
}

describe('WatchErrorNotifier', () => {
  it('báo lỗi refresh nền kèm project và thông điệp', () => {
    const { sent, notifier } = setup()
    expect(notifier.report('p1', new Error('SQLITE_READONLY: attempt to write a readonly database'))).toBe(true)
    expect(sent).toEqual([{ projectId: 'p1', message: 'SQLITE_READONLY: attempt to write a readonly database' }])
  })

  it('cùng lỗi lặp lại thì không spam; lỗi khác hoặc sau cửa sổ chờ thì báo lại', () => {
    const { sent, notifier, advance } = setup()
    notifier.report('p1', new Error('disk I/O error'))
    notifier.report('p1', new Error('disk I/O error'))
    expect(sent).toHaveLength(1)
    advance(WATCH_ERROR_REPEAT_MS)
    notifier.report('p1', new Error('disk I/O error'))
    expect(sent).toHaveLength(2)
    notifier.report('p1', new Error('database is locked'))
    expect(sent).toHaveLength(3)
    // Dự án khác có cửa sổ riêng.
    notifier.report('p2', new Error('disk I/O error'))
    expect(sent.map((s) => s.projectId)).toEqual(['p1', 'p1', 'p1', 'p2'])
  })

  it('refresh thành công (clear) thì lần lỗi sau báo lại ngay', () => {
    const { sent, notifier } = setup()
    notifier.report('p1', new Error('disk I/O error'))
    notifier.report('p1', new Error('disk I/O error'))
    expect(sent).toHaveLength(1)
    notifier.clear('p1')
    notifier.report('p1', new Error('disk I/O error'))
    expect(sent).toHaveLength(2)
  })

  it('khôi phục sau lỗi gửi tín hiệu để UI gỡ cảnh báo cũ, và chỉ gửi khi đã có lỗi', () => {
    const recovered: string[] = []
    const notifier = new WatchErrorNotifier(() => {}, (projectId) => recovered.push(projectId), () => 1_000_000)
    expect(notifier.recover('p1')).toBe(false)
    expect(recovered).toEqual([])
    notifier.report('p1', new Error('disk I/O error'))
    expect(notifier.recover('p1')).toBe(true)
    expect(recovered).toEqual(['p1'])
    // Đã khôi phục: lần lỗi y hệt sau đó phải báo lại ngay, không bị dedupe.
    const sent: unknown[] = []
    const n2 = new WatchErrorNotifier((f) => sent.push(f), () => recovered.push('x'), () => 1_000_000)
    n2.report('p1', new Error('disk I/O error'))
    n2.recover('p1')
    n2.report('p1', new Error('disk I/O error'))
    expect(sent).toHaveLength(2)
  })

  it('cắt thông điệp dài và nhận cả lỗi không phải Error', () => {
    const { sent, notifier } = setup()
    notifier.report('p1', 'lỗi chuỗi')
    notifier.report('p2', new Error('x'.repeat(5_000)))
    expect(sent[0].message).toBe('lỗi chuỗi')
    expect(sent[1].message).toHaveLength(500)
  })
})
