import { afterEach, describe, expect, it } from 'vitest'
import { errorText } from './errorText'
import { errorMsg } from './errorText'
import { msg, msgText } from './messages'
import { setLocale } from './locale'

/**
 * I1 (review #57): `msg('Không tải được: {error}', { error: errMessage(e) })` chốt câu lỗi thô
 * vào biến nên UI English vẫn hiện tiếng Việt. Biến của `Msg` phải nhận `Message` và dịch lúc render.
 */
describe('biến của msg nhận Message lồng nhau', () => {
  afterEach(() => setLocale('vi'))

  it('dịch câu lỗi lồng theo ngôn ngữ hiện tại, không chốt lúc gọi', () => {
    const m = msg('Không tải được: {error}', { error: errorMsg({ code: 'engine_unavailable', message: 'Engine chưa sẵn sàng.' }) })
    setLocale('vi')
    expect(msgText(m)).toBe('Không tải được: Engine chưa sẵn sàng.')
    setLocale('en')
    expect(msgText(m)).toBe('Could not load: The engine is not ready yet.')
    expect(errorText({ code: 'engine_unavailable', message: 'Engine chưa sẵn sàng.' })).toBe('The engine is not ready yet.')
  })
})
