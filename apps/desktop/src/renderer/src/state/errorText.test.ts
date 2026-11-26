import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from './locale'
import { errorText } from './errorText'

afterEach(() => setLocale('vi'))

/** Câu lỗi cứng trong main/features/agent/session.ts phải đi qua cơ chế i18n của renderer (knownErrors + tr). */
const sessionErrors = [
  'Chọn mô hình trước khi tạo hội thoại',
  'Chọn mô hình trước khi tách hội thoại',
  'Chọn mô hình trước khi mở hội thoại',
  'Chưa chọn mô hình',
  'Hội thoại không thuộc tài khoản và dự án đang chọn',
  'Trợ lý đang chạy tác vụ. Bấm Dừng trước khi đổi hội thoại hoặc quyền thực thi.',
  'Trợ lý đang trả lời',
  'Câu hỏi trống hoặc vượt 200.000 ký tự',
  'Không nạp được bộ công cụ an toàn của NexGraph',
  'Đã đạt giới hạn thời gian của tác vụ',
  'Đã đạt ngân sách token của tác vụ',
  'Đã đạt giới hạn số lượt gọi mô hình của tác vụ'
]

/** Đọc thẳng mã nguồn main để không bỏ sót câu mới thêm; chỉ hai literal không phải câu lỗi được miễn. */
const sessionSource = readFileSync(fileURLToPath(new URL('../../../main/features/agent/session.ts', import.meta.url)), 'utf8')
const NON_ERROR_LITERALS: (string | RegExp)[] = [
  /^Bạn là trợ lý mã nguồn NexGraph\./, // system prompt gửi model
  'Hãy phân tích ảnh đính kèm.' // câu mặc định khi người dùng chỉ gửi ảnh
]
const vietnameseLiterals = [...new Set([...sessionSource.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]))]
  .filter((text) => /[À-Ỹà-ỹ]/.test(text))
  .filter((text) => !NON_ERROR_LITERALS.some((rule) => typeof rule === 'string' ? rule === text : rule.test(text)))

describe('errorText', () => {
  it('giữ nguyên câu tiếng Việt khi giao diện tiếng Việt', () => {
    for (const message of sessionErrors) expect(errorText({ message })).toBe(message)
  })

  it('dịch câu lỗi của main sang tiếng Anh khi giao diện English', () => {
    setLocale('en')
    expect(errorText({ message: 'Chọn mô hình trước khi tạo hội thoại' })).toMatch(/Select a model before creating/i)
    expect(errorText({ message: 'Chọn mô hình trước khi tách hội thoại' })).toMatch(/Select a model before branching/i)
    expect(errorText({ message: 'Chọn mô hình trước khi mở hội thoại' })).toMatch(/Select a model before opening/i)
    expect(errorText({ message: 'Chưa chọn mô hình' })).toMatch(/No model selected/i)
    expect(errorText({ message: 'Hội thoại không thuộc tài khoản và dự án đang chọn' })).toMatch(/does not belong to the selected account and project/i)
    for (const message of sessionErrors) expect(errorText({ message })).not.toBe(message)
  })

  it('phủ TOÀN BỘ literal tiếng Việt trong main/features/agent/session.ts (MIN-46 M1)', () => {
    expect(vietnameseLiterals.length).toBeGreaterThan(35)
    setLocale('en')
    const missing = vietnameseLiterals.filter((text) => errorText({ message: text }) === text)
    expect(missing).toEqual([])
    // Bản tiếng Việt không được đổi câu của main.
    setLocale('vi')
    for (const text of vietnameseLiterals) expect(errorText({ message: text })).toBe(text)
  })

  it('dịch câu ngữ cảnh nhỏ có số token thật (MIN-46 M3)', () => {
    const text = 'Mô hình chỉ có 6000 token ngữ cảnh, không đủ cho system prompt + công cụ — chọn mô hình lớn hơn.'
    expect(errorText({ message: text })).toBe(text)
    setLocale('en')
    expect(errorText({ message: text }))
      .toBe('The model has only 6000 context tokens — not enough for the system prompt and tools. Choose a larger model.')
  })

  it('I18N-IPC: câu "Engine chưa sẵn sàng." của main cũng dịch được', () => {
    expect(errorText({ message: 'Engine chưa sẵn sàng.' })).toBe('Engine chưa sẵn sàng.')
    setLocale('en')
    expect(errorText({ message: 'Engine chưa sẵn sàng.' })).toBe('The engine is not ready yet.')
  })


  it('I2: lỗi có mã nhưng câu là thô của công cụ thì giữ câu gốc, không thay bằng câu chung', () => {
    const fatal = "fatal: '/tmp/nope' does not appear to be a git repository"
    setLocale('en')
    expect(errorText({ code: 'git_failed', message: fatal })).toBe(fatal)
    expect(errorText({ code: 'internal', message: 'LLM returned 502 Bad Gateway' })).toBe('LLM returned 502 Bad Gateway')
    expect(errorText({ code: 'no_git', message: 'git: command not found' })).toBe('git: command not found')
    // Câu Việt của app vẫn dịch theo mã; câu rỗng dùng câu chung của mã.
    expect(errorText({ code: 'git_failed', message: 'Thao tác Git không thành công' })).toBe('The Git operation failed')
    expect(errorText({ code: 'git_failed', message: '' })).toBe('The Git operation failed')
    setLocale('vi')
    // VI: câu Anh của engine (nguồn URL) vẫn dịch theo mã; stderr của công cụ giữ nguyên.
    expect(errorText({ code: 'blocked_private_ip', message: 'Blocked private/internal IP: 127.0.0.1' }))
      .toBe('URL nguồn trỏ tới địa chỉ IP riêng hoặc nội bộ nên bị chặn.')
    expect(errorText({ code: 'git_failed', message: fatal })).toBe(fatal)
  })

  it('câu lạ đi nguyên văn, không nuốt lỗi', () => {
    setLocale('en')
    expect(errorText(new Error('một lỗi lạ'))).toBe('một lỗi lạ')
    // Mã lạ: không có bản dịch thì giữ câu gốc, kể cả câu Việt.
    expect(errorText({ code: 'something_new', message: 'Endpoint không hợp lệ' })).toBe('Endpoint không hợp lệ')
    // Mã có trong codeErrors (I3): UI English dịch câu Việt cố định của main.
    expect(errorText({ code: 'bad_param', message: 'Endpoint không hợp lệ' })).toBe('Invalid parameter.')
  })

  it('chặn đổi runtime giữa lượt có câu VI và bản Anh', () => {
    const error = { code: 'runtime_switch_blocked', message: 'Không đổi runtime khi trợ lý đang chạy hoặc đang chờ duyệt. Hãy dừng lượt hiện tại trước.' }
    expect(errorText(error)).toBe('Không đổi runtime khi trợ lý đang chạy hoặc đang chờ duyệt. Hãy dừng lượt hiện tại trước.')
    setLocale('en')
    expect(errorText(error)).toBe('Cannot switch runtime while the assistant is running or waiting for approval. Stop the current turn first.')
  })
})
