// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ScanInfo } from '@shared/graph-types'
import { project } from '../test-utils'
import { LargeProjectScreen } from './LargeProjectScreen'

const scan: ScanInfo = {
  files: 12345, by_language: { dart: 12000 }, large: true, threshold: 5000,
  top_dirs: [{ path: 'lib/features', files: 9000 }, { path: 'packages/Đồ án', files: 3000 }]
}

function setup() {
  const onChoose = vi.fn()
  const onCancel = vi.fn()
  render(<LargeProjectScreen project={project()} scan={scan} onChoose={onChoose} onCancel={onCancel} />)
  return { onChoose, onCancel }
}

describe('LargeProjectScreen', () => {
  it('states the file count and threshold in vi-VN format', () => {
    setup()
    expect(screen.getByText(/12\.345 tệp mã/)).toBeInTheDocument()
    expect(screen.getByText(/vượt ngưỡng 5\.000/)).toBeInTheDocument()
  })

  it('lists top directories with file counts and chooses one', async () => {
    const { onChoose } = setup()
    const btn = screen.getByRole('button', { name: /lib\/features/ })
    expect(btn).toHaveTextContent('9.000 tệp')
    await userEvent.click(btn)
    expect(onChoose).toHaveBeenCalledWith('lib/features')
    await userEvent.click(screen.getByRole('button', { name: /packages\/Đồ án/ }))
    expect(onChoose).toHaveBeenLastCalledWith('packages/Đồ án')
  })

  it('can index everything or cancel', async () => {
    const { onChoose, onCancel } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Lập chỉ mục toàn bộ' }))
    expect(onChoose).toHaveBeenCalledWith(null)
    await userEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
