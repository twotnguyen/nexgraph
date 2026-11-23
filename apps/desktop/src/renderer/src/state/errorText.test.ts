import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from './locale'
import { errorText } from './errorText'

afterEach(() => setLocale('vi'))

/** Câu lỗi cứng trong main/agent/session.ts phải đi qua cơ chế i18n của renderer (knownErrors + tr). */
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

  it('câu lạ đi nguyên văn, không nuốt lỗi', () => {
    setLocale('en')
    expect(errorText(new Error('một lỗi lạ'))).toBe('một lỗi lạ')
    expect(errorText({ code: 'bad_param', message: 'Endpoint không hợp lệ' })).toBe('Endpoint không hợp lệ')
  })
})
