// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EngineStatusBar } from './EngineStatusBar'

describe('EngineStatusBar', () => {
  it('shows starting', () => {
    render(<EngineStatusBar status={{ state: 'starting' }} onRestart={() => {}} />)
    expect(screen.getByText('Engine: đang khởi động…')).toBeInTheDocument()
  })

  it('shows ready with version', () => {
    render(
      <EngineStatusBar
        status={{ state: 'ready', engineVersion: '0.1.0', vendorCommit: '86c57be' }}
        onRestart={() => {}}
      />
    )
    expect(screen.getByText('Engine: sẵn sàng (v0.1.0)')).toBeInTheDocument()
  })

  it('EngineStatusBar shows error and restart', async () => {
    const onRestart = vi.fn()
    render(<EngineStatusBar status={{ state: 'error', message: 'exit 5' }} onRestart={onRestart} />)
    expect(screen.getByText('Engine: lỗi — exit 5')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Khởi động lại' }))
    expect(onRestart).toHaveBeenCalled()
  })
})
