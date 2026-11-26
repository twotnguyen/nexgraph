// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Citation } from '@nexgraph/contracts/graph-types'
import { installNexgraph } from '../../test-utils'
import { AnswerRating } from './AnswerRating'

const citations: Citation[] = [
  { raw: 'lib/a.dart:3', file: 'lib/a.dart', start: 3, end: 5, valid: true, reason: null },
  { raw: 'lib/x.dart:9', file: 'lib/x.dart', start: 9, end: 9, valid: false, reason: 'file_not_found' }
]
let api: ReturnType<typeof installNexgraph>['api']

describe('AnswerRating', () => {
  beforeEach(() => { api = installNexgraph().api })

  it.each([['Hữu ích', 'huu_ich'], ['Ngõ cụt', 'ngo_cut']] as const)('%s gửi outcome %s kèm trích dẫn hợp lệ rồi khoá nút', async (name, outcome) => {
    render(<AnswerRating projectId="p1" question="Đăng nhập ở đâu?" answer="Ở lib/a.dart:3" citations={citations} />)
    await userEvent.click(screen.getByRole('button', { name }))
    expect(api.memory.rate).toHaveBeenCalledWith('p1', { question: 'Đăng nhập ở đâu?', answer: 'Ở lib/a.dart:3', outcome,
      citations: [{ file: 'lib/a.dart', line: 3 }] })
    expect(await screen.findByRole('status')).toHaveTextContent('Đã lưu đánh giá')
    expect(screen.queryByRole('button', { name: 'Hữu ích' })).not.toBeInTheDocument()
  })

  it('Đã sửa đòi nhập câu trả lời đúng trước khi lưu', async () => {
    render(<AnswerRating projectId="p1" question="q" answer="a" citations={[]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Đã sửa' }))
    const save = screen.getByRole('button', { name: 'Lưu' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Câu trả lời đúng là gì?'), 'Dùng SharedPreferences')
    await userEvent.click(save)
    expect(api.memory.rate).toHaveBeenCalledWith('p1', { question: 'q', answer: 'a', outcome: 'da_sua',
      correction: 'Dùng SharedPreferences', citations: [] })
  })

  it('lỗi từ engine (đang index) hiện ra và cho bấm lại', async () => {
    vi.mocked(api.memory.rate).mockRejectedValueOnce({ code: 'index_running', message: 'Dự án đang được lập chỉ mục' })
    render(<AnswerRating projectId="p1" question="q" answer="a" citations={[]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Hữu ích' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Không lưu được: Dự án đang được lập chỉ mục')
    expect(screen.getByRole('button', { name: 'Hữu ích' })).toBeEnabled()
  })
})
