// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthLinks } from './AuthLinks'

describe('AuthLinks', () => {
  it('renders provider authorization and info links with safe external attributes', () => {
    const view = render(<AuthLinks event={{ type: 'auth_url', url: 'https://auth.openai.com/authorize', instructions: 'Đăng nhập' }} />)
    expect(screen.getByRole('link')).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
    view.rerender(<AuthLinks event={{ type: 'info', message: 'Chọn xác nhận', links: [{ url: 'https://auth.openai.com/confirm' }] }} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://auth.openai.com/confirm')
  })

  it('does not create links for scripts, plaintext HTTP or credential-bearing URLs', () => {
    render(<AuthLinks event={{ type: 'info', message: 'Links', links: [
      { url: 'javascript:alert(1)' }, { url: 'http://auth.openai.com/' }, { url: 'https://user:secret@auth.openai.com/' }
    ] }} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
