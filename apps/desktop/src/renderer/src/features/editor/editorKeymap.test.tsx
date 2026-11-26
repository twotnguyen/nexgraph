// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { installKeymap, registerHandler } from '../../shared/lib/commands'

it('gives F2 to the tree and input fields but routes it from Monaco to rename', () => {
  const rename = vi.fn()
  const unregister = registerHandler('editor.rename', rename)
  const uninstall = installKeymap()
  try {
    render(<><div role="tree" tabIndex={0} aria-label="Tệp" /><input aria-label="Tìm" /><div className="monaco-editor"><textarea aria-label="Mã" /></div></>)
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'F2', code: 'F2' })
    fireEvent.keyDown(screen.getByLabelText('Tìm'), { key: 'F2', code: 'F2' })
    expect(rename).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('Mã'), { key: 'F2', code: 'F2' })
    expect(rename).toHaveBeenCalledOnce()
  } finally {
    unregister()
    uninstall()
  }
})
it('vẫn cho phím tắt đóng bảng lệnh chạy trong hộp thoại, nhưng không chạy lệnh editor', () => {
  const settings = vi.fn()
  const rename = vi.fn()
  const unregister = [registerHandler('settings.open', settings), registerHandler('editor.rename', rename)]
  const uninstall = installKeymap()
  try {
    render(<div role="dialog"><input aria-label="Tên mới" /></div>)
    const input = screen.getByLabelText('Tên mới')
    fireEvent.keyDown(input, { key: ',', code: 'Comma', ctrlKey: true })
    expect(settings).toHaveBeenCalledOnce()
    fireEvent.keyDown(input, { key: 'F2', code: 'F2' })
    expect(rename).not.toHaveBeenCalled()
  } finally {
    for (const off of unregister) off()
    uninstall()
  }
})
