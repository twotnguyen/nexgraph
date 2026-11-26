import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../shared/lib/locale'
import { tr, vi as t } from './strings'
import { localizeCommand } from '../shared/lib/commandLabels'
import { retryReason } from '../features/agent/retry'

afterEach(() => setLocale('vi'))

describe('vi.path.found', () => {
  it('ghi độ tin cậy của hop yếu nhất', () => {
    expect(t.path.found(3, { level: 'INFERRED', score: 0.6, hop: 2 })).toBe('Đường đi 3 bước · tin cậy: suy luận 0,6 (bước 2)')
    expect(t.path.found(1, { level: 'EXTRACTED', score: null, hop: 1 })).toBe('Đường đi 1 bước · tin cậy: trích từ mã')
    expect(t.path.found(2, null)).toBe('Đường đi 2 bước')
  })
})

describe('i18n', () => {
  it('EN: cùng lỗi ai_unreachable ra cùng một câu ở dòng lỗi và dòng thử lại', () => {
    setLocale('en')
    expect(t.chat.errors.ai_unreachable).toBe('Could not connect to the AI provider.')
    expect(retryReason('fetch failed')).toBe('Could not connect to the AI provider.')
    expect(tr('Không kết nối được tới nhà cung cấp AI.')).toBe('Could not connect to the AI provider.')
  })

  it('EN: ai_provider_error ra cùng một câu ở Cài đặt và chat (MIN-46 M8)', () => {
    setLocale('en')
    expect(tr('Nhà cung cấp AI tạm thời gặp lỗi.')).toBe(t.chat.errors.ai_provider_error)
    expect(t.chat.errors.ai_provider_error).toBe('The AI provider is temporarily unavailable.')
  })

  it('nhãn Context window của nhà cung cấp tuỳ chỉnh có bản tiếng Anh', () => {
    setLocale('vi')
    expect(t.accounts.customContext).toBe('Context window (token)')
    expect(t.accounts.customContextInvalid).toMatch(/số nguyên dương/)
    setLocale('en')
    expect(t.accounts.customContext).toBe('Context window (tokens)')
    expect(t.accounts.customContextInvalid).toMatch(/positive integer/)
  })

  it('đổi dictionary ngay khi đổi locale', () => {
    setLocale('vi')
    expect(t.accounts.title).toBe('Tài khoản AI')
    setLocale('en')
    expect(t.accounts.title).toBe('AI accounts')
    expect(t.indexing.titleDone('demo')).toBe('Indexed: demo')
  })

  it('không lộ thương hiệu "Pi" trong chuỗi người dùng thấy (A1 F1)', () => {
    setLocale('vi')
    expect(t.chat.setupTitle).toBe('Thiết lập trợ lý AI')
    setLocale('en')
    expect(t.chat.setupTitle).toBe('Set up the AI assistant')
    // Nhắc tới "Pi" như một sản phẩm khác trong Cài đặt là sai thương hiệu; tên nhà cung cấp kỹ thuật thì giữ.
    setLocale('vi')
    const commitHint = 'Hãy chọn model AI trong Cài đặt để viết thông điệp commit.'
    expect(tr(commitHint)).toBe(commitHint)
    setLocale('en')
    expect(tr(commitHint)).toBe('Select an AI model in Settings to write a commit message.')
  })

  it('enStrings có đủ các nhóm của bản tiếng Việt', () => {
    setLocale('vi')
    const groups = Object.keys(t) as (keyof typeof t)[]
    expect(groups).toHaveLength(34)
    setLocale('en')
    for (const group of groups) expect(t[group]).toBeDefined()
  })

  it('MIN-54: thông báo nguồn ảo có bản tiếng Anh', () => {
    setLocale('en')
    expect(tr('Nguồn ảo — chọn node trên đồ thị để xem chi tiết.')).toBe('Virtual source — select the node on the graph to see details.')
  })

  it('tr thay biến và giữ nguyên chuỗi khi thiếu bản dịch', () => {
    const missing = 'chưa có bản __test_missing_translation__'
    setLocale('vi')
    expect(tr('Đã gỡ {name}…', { name: 'demo' })).toBe('Đã gỡ demo…')
    setLocale('en')
    expect(tr(missing)).toBe(missing)
    expect(tr(`${missing} {name}`, { name: 'demo' })).toBe(`${missing} demo`)
    expect(tr(`${missing} n={n}`, { n: 2 })).toBe(`${missing} n=2`)
  })

  it('dịch nhãn chẩn đoán và đồng tác giả sang tiếng Anh', () => {
    setLocale('en')
    expect(tr('Bao gồm cảnh báo')).toBe('Include warnings')
    expect(tr('Làm mới chẩn đoán')).toBe('Refresh diagnostics')
    expect(tr('Đang làm mới…')).toBe('Refreshing…')
    expect(tr('Đang tải…')).toBe('Downloading…')
    expect(tr('Đồng tác giả')).toBe('Co-authors')
    expect(tr('Thêm đồng tác giả')).toBe('Add co-author')
    expect(tr('Tên và email đồng tác giả')).toBe('Co-author name and email')
    expect(tr('Tên <email>')).toBe('Name <email>')
  })

  it('dịch Luồng {id} là Flow chứ không phải Thread', () => {
    setLocale('en')
    expect(tr('Luồng {id}', { id: '1' })).toBe('Flow 1')
  })

  it('dịch nhãn separator của PaneStack sang tiếng Anh', () => {
    setLocale('en')
    expect(tr('Chiều cao {section}', { section: tr('Ngăn xếp gọi') })).toBe('Height of Call stack')
    expect(tr('Chiều cao {section}', { section: tr('Biến') })).toBe('Height of Variables')
  })

  it('dịch nhãn activity rail mới sang tiếng Anh', () => {
    setLocale('en')
    expect(tr('Tìm trong đồ thị')).toBe('Search Graph')
    expect(tr('Vùng ảnh hưởng')).toBe('Impact')
    expect(tr('Ký hiệu tệp')).toBe('File Symbols')
    expect(tr('Tệp thay đổi')).toBe('Changed Files')
  })

  it('dịch nhãn mới của thanh trạng thái và bảng lệnh sang tiếng Anh', () => {
    setLocale('en')
    expect(tr('Trạng thái engine')).toBe('Engine status')
    expect(tr('Chi tiết chẩn đoán')).toBe('Diagnostic details')
    expect(tr('Vùng chọn')).toBe('Selection')
    expect(tr('Thụt lề')).toBe('Indentation')
    expect(tr('Thụt lề: {n}', { n: 4 })).toBe('Indent: 4')
    expect(tr('Đã chọn {n}', { n: 3 })).toBe('3 selected')
    expect(tr('Thêm phím tắt…')).toBe('Add keybinding…')
    expect(tr('Đổi phím tắt…')).toBe('Change keybinding…')
    expect(tr('Chạy')).toBe('Run')
    expect(localizeCommand({ id: 'editor.indentation_selector', title: 'Chọn kiểu thụt lề (indent)', category: 'Editor' }))
      .toEqual({ title: 'Select Indentation', category: 'Editor' })
  })

  it('dịch mô tả nhà cung cấp OpenCode Go và OpenCode Zen sang tiếng Anh', () => {
    setLocale('en')
    for (const text of ['Gói OpenCode Go: dùng API key OpenCode, model lấy từ danh mục của OpenCode',
      'OpenCode Zen: dùng API key OpenCode, tính phí theo lượng dùng']) {
      expect(tr(text)).not.toBe(text)
      expect(tr(text)).toMatch(/OpenCode/)
    }
  })
})
