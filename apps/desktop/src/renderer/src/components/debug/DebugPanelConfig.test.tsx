// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { DebugEvent } from '@shared/api'
import { setDebugProject } from '../../state/debugState'
import { DebugPanel } from './DebugPanel'

afterEach(() => vi.unstubAllGlobals())

it('liệt kê cấu hình, Start chạy cấu hình đã chọn, F5 mặc định giữ nguyên và form Attach gửi host/cổng', async () => {
  let emit: (event: DebugEvent) => void = () => {}
  const start = vi.fn(async () => {})
  const startConfig = vi.fn(async () => {})
  const attach = vi.fn(async () => {})
  const configFile = vi.fn(async () => '.vscode/launch.json')
  const configs = vi.fn(async () => [
    { name: 'Python: app', source: '.vscode/launch.json', kind: 'python', request: 'launch' },
    { name: 'Node attach', source: '.vscode/launch.json', kind: 'node', request: 'attach' }
  ])
  vi.stubGlobal('nexgraph', { debug: {
    adapterStatus: async () => ({ node: true, python: true }),
    onEvent: (handler: (event: DebugEvent) => void) => { emit = handler; return () => {} },
    configs, configFile, start, startConfig, attach
  } })
  setDebugProject('config-test')
  const open = vi.fn()
  render(<DebugPanel projectId="config-test" target="a.py" onOpenFile={open} />)
  const select = await screen.findByRole('combobox', { name: 'Cấu hình khởi chạy' })
  await screen.findByRole('option', { name: 'Python: app · launch' })
  expect(screen.getByRole('option', { name: 'Node attach · attach' })).toBeInTheDocument()

  // Cấu hình đã chọn thay cho "chạy tệp đang mở"; tệp đang mở vẫn được gửi để thay ${file}.
  await userEvent.selectOptions(select, screen.getByRole('option', { name: 'Python: app · launch' }))
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu gỡ lỗi' }))
  await waitFor(() => expect(startConfig).toHaveBeenCalledWith('config-test', { source: '.vscode/launch.json', name: 'Python: app' }, 'a.py', {}))
  expect(start).not.toHaveBeenCalled()
  act(() => emit({ type: 'state', state: 'terminated' }))

  // Bỏ chọn: hành vi cũ, chạy thẳng tệp đang mở.
  await userEvent.selectOptions(select, screen.getByRole('option', { name: 'Chạy tệp đang mở' }))
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu gỡ lỗi' }))
  await waitFor(() => expect(start).toHaveBeenCalledWith('config-test', 'python', 'a.py', {}))
  expect(startConfig).toHaveBeenCalledTimes(1)
  act(() => emit({ type: 'state', state: 'terminated' }))

  // Attach: ô trống dùng mặc định của từng loại; điền thì gửi đúng host và cổng dạng số.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Attach' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
  await waitFor(() => expect(attach).toHaveBeenLastCalledWith('config-test', 'node', 'localhost', 9229, {}))
  act(() => emit({ type: 'state', state: 'terminated' }))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Loại tiến trình' }), 'Python')
  fireEvent.change(screen.getByRole('textbox', { name: 'Địa chỉ' }), { target: { value: ' 10.0.0.5 ' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Cổng' }), { target: { value: '7000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
  await waitFor(() => expect(attach).toHaveBeenLastCalledWith('config-test', 'python', '10.0.0.5', 7000, {}))
  act(() => emit({ type: 'state', state: 'terminated' }))

  // Mở tệp cấu hình trong editor rồi đọc lại danh sách; tệp hỏng hiện lỗi từ main (đối tượng thường, không phải Error).
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mở tệp cấu hình gỡ lỗi' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Mở tệp cấu hình gỡ lỗi' }))
  await waitFor(() => expect(open).toHaveBeenCalledWith('.vscode/launch.json', 1))
  await waitFor(() => expect(configs).toHaveBeenCalledTimes(2))
  configs.mockRejectedValueOnce({ code: 'invalid_debug_config', message: 'Tệp .vscode/launch.json không phải JSON hợp lệ.' })
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại cấu hình' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Tệp .vscode/launch.json không phải JSON hợp lệ.')
})
