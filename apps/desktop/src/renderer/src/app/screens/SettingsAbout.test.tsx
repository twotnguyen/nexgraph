// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { setLocale } from '../../shared/lib/locale'
import { SettingsScreen } from './SettingsScreen'

/** LIC-2: mục Giới thiệu trong Cài đặt là chỗ người dùng thấy phiên bản và mở màn Giấy phép. */
const open = (onOpenLicenses = vi.fn()) => {
  installNexgraph({ app: { version: vi.fn(async () => '0.2.0-alpha.1') } })
  render(<SettingsScreen onBack={vi.fn()} onOpenLicenses={onOpenLicenses} />)
  return onOpenLicenses
}

afterEach(() => {
  cleanup()
  setLocale('vi')
})

it('Giới thiệu: hiện tên app, phiên bản và mở màn Giấy phép mã nguồn mở', async () => {
  const onOpenLicenses = open()
  expect(screen.getByRole('heading', { level: 1, name: 'Giới thiệu' })).toBeInTheDocument()
  expect(await screen.findByText('Phiên bản 0.2.0-alpha.1')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Giấy phép mã nguồn mở' }))
  expect(onOpenLicenses).toHaveBeenCalledTimes(1)
})

it('Giới thiệu: nhãn English theo ngôn ngữ UI', async () => {
  setLocale('en')
  open()
  expect(screen.getByRole('heading', { level: 1, name: 'About' })).toBeInTheDocument()
  expect(await screen.findByText('Version 0.2.0-alpha.1')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Source Licenses' })).toBeInTheDocument()
})
