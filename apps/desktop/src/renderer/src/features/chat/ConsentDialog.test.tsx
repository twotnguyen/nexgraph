// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsentDialog } from './ConsentDialog'

describe('ConsentDialog', () => {
  it('tài khoản Nex đăng nhập trong sidecar: nêu đúng tài khoản nhận dữ liệu, không in định danh nội bộ', () => {
    render(<ConsentDialog project="demo" model="gpt-5" target={{ runtime: 'nex', provider: 'openai', baseUrl: 'nex-account:openai' }}
      onOk={() => {}} onCancel={() => {}} />)
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text).toContain('tài khoản openai đã đăng nhập trong Nex')
    expect(text).toContain('gpt-5')
    expect(text).not.toContain('nex-account:')
  })

  it('nhà cung cấp có URL (Pi hoặc Nex dùng key của app): vẫn nêu URL đích', () => {
    render(<ConsentDialog project="demo" model="m1" target={{ runtime: 'nex', provider: 'acme', baseUrl: 'https://acme.example/v1' }}
      onOk={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('dialog').textContent).toContain('https://acme.example/v1')
  })
})
