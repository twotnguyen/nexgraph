import { describe, expect, it } from 'vitest'
import { NEX_DISABLED_TOOLS, NEX_ENABLED_TOOLS } from '../src/main/features/agent/nex/config'
import { nexInstructions } from '../src/main/features/agent/nex/instructions'
import { CITATION_RULE, NEXGRAPH_RULES, UNTRUSTED_DATA_RULE } from '../src/main/features/agent/skill'

const text = nexInstructions()
/** Tên tool ở dạng code (`read`), cách tệp chỉ dẫn giới thiệu một tool dùng được. */
const mentions = (tool: string) => text.includes(`\`${tool}\``)

describe('chỉ dẫn hệ thống của Nex', () => {
  it('nói Nex là trợ lý của NexGraph, làm việc trên dự án đang mở, trả lời theo ngôn ngữ người dùng', () => {
    expect(text).toMatch(/Nex/)
    expect(text).toMatch(/NexGraph/)
    expect(text).toMatch(/ngôn ngữ/)
  })

  it('mô tả đủ ba chế độ và việc sửa tệp/chạy lệnh cần duyệt', () => {
    for (const mode of ['Hỏi', 'Kế hoạch', 'Sửa']) expect(text).toContain(`**${mode}**`)
    expect(text).toMatch(/duyệt/)
  })

  it('giới thiệu mọi tool OpenCode còn bật, không giới thiệu tool đã tắt', () => {
    for (const tool of NEX_ENABLED_TOOLS) expect(mentions(tool), tool).toBe(true)
    for (const tool of NEX_DISABLED_TOOLS) expect(mentions(tool), tool).toBe(false)
  })

  it('giải thích tiền tố nexgraph_ của tool đồ thị và nêu các tool chính theo tên thật', () => {
    expect(text).toContain('`nexgraph_`')
    for (const tool of ['nexgraph_get_context', 'nexgraph_search', 'nexgraph_get_impact', 'nexgraph_tests_for', 'nexgraph_read_code', 'nexgraph_remember']) {
      expect(mentions(tool), tool).toBe(true)
    }
  })

  it('có lối lùi khi đồ thị chưa sẵn sàng (chưa lập chỉ mục, engine lỗi)', () => {
    expect(text).toMatch(/lập chỉ mục/)
  })

  it('dùng đúng quy tắc trích dẫn và quy tắc dữ liệu không tin cậy của Pi/Gemini, không viết lại bản khác', () => {
    expect(text).toContain(CITATION_RULE)
    expect(text).toContain(UNTRUSTED_DATA_RULE)
    // Tách hằng không được làm đổi chỉ dẫn của hai runtime còn lại.
    expect(NEXGRAPH_RULES).toContain(`3. ${CITATION_RULE}`)
    expect(NEXGRAPH_RULES).toContain(`4. ${UNTRUSTED_DATA_RULE}`)
  })
})
