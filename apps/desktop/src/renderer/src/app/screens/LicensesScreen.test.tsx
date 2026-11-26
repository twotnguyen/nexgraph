// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { setLocale } from '../../shared/lib/locale'
import { LicensesScreen, splitLicenseSections } from './LicensesScreen'

const TEXT = `# Phần mềm bên thứ ba

Mỗi mục ghi nguồn, giấy phép và phần nào của NexGraph dùng nó.

## Graphify

Graphify
Copyright 2026 Safi Shamsi and the Graphify contributors.

Apache License
Version 2.0, January 2004

## Monaco Editor

The MIT License (MIT)

Copyright (c) 2016 - present Microsoft Corporation

## d3

ISC License

Copyright 2010-2026 Mike Bostock
`

const open = (read = vi.fn(async () => ({ text: TEXT, path: '/x/THIRD_PARTY_LICENSES.md' }))) => {
  installNexgraph({ licenses: { read } })
  render(<LicensesScreen onBack={vi.fn()} />)
  return read
}

afterEach(() => {
  cleanup()
  setLocale('vi')
})

describe('màn Giấy phép mã nguồn mở (LIC-2)', () => {
  it('hiển thị nội dung THIRD_PARTY_LICENSES.md đã đóng gói, chỉ đọc, có tiêu đề VI', async () => {
    const read = open()
    expect(read).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { level: 1, name: 'Giấy phép mã nguồn mở' })).toBeInTheDocument()
    // Nội dung là văn bản thường (không phải ô nhập): duy nhất ô tìm là searchbox.
    expect(screen.getByText(/Copyright 2026 Safi Shamsi and the Graphify contributors\./)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Monaco Editor' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(document.querySelectorAll('pre').length).toBeGreaterThanOrEqual(3)
    expect(document.querySelector('[role="document"]')).toHaveAttribute('aria-readonly', 'true')
  })

  it('ô tìm lọc theo mục, tô sáng từ khoá và báo số mục khớp', async () => {
    open()
    const search = await screen.findByRole('searchbox', { name: 'Tìm trong giấy phép' })
    await userEvent.type(search, 'apache')
    expect(screen.getByRole('heading', { name: 'Graphify' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Monaco Editor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'd3' })).not.toBeInTheDocument()
    expect(screen.getByText('1/3 mục')).toBeInTheDocument()
    const marks = [...document.querySelectorAll('mark')].map((mark) => mark.textContent)
    expect(marks).toEqual(['Apache'])
  })

  it('không khớp thì báo rõ, không để trang trắng', async () => {
    open()
    const search = await screen.findByRole('searchbox', { name: 'Tìm trong giấy phép' })
    await userEvent.type(search, 'không-có-gì')
    expect(screen.getByText('Không có mục nào khớp “không-có-gì”')).toBeInTheDocument()
  })

  it('bản English dùng nhãn English', async () => {
    setLocale('en')
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Open Source Licenses' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search licenses' })).toBeInTheDocument()
    expect(screen.getByText('3/3 sections')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('bản English chọn số ít/số nhiều theo tổng số mục: "1/1 section", "1/3 sections", "0/3 sections"', async () => {
    setLocale('en')
    open(vi.fn(async () => ({ text: '# Third-party software\n\n## d3\n\nISC License\n', path: '/x/THIRD_PARTY_LICENSES.md' })))
    expect(await screen.findByText('1/1 section')).toBeInTheDocument()
    cleanup()

    open()
    const search = await screen.findByRole('searchbox', { name: 'Search licenses' })
    expect(screen.getByText('3/3 sections')).toBeInTheDocument()
    await userEvent.type(search, 'apache')
    expect(screen.getByText('1/3 sections')).toBeInTheDocument()
    await userEvent.clear(search)
    await userEvent.type(search, 'không-có-gì')
    expect(screen.getByText('0/3 sections')).toBeInTheDocument()
  })

  it('nội dung checkout CRLF (Windows core.autocrlf) tách mục, tìm kiếm và hiển thị y như LF (B3)', async () => {
    const crlf = TEXT.replace(/\n/g, '\r\n')
    // Mục, tiêu đề và thân mục giống hệt bản LF: không sót `\r` trong dữ liệu đưa lên DOM.
    expect(splitLicenseSections(crlf)).toEqual(splitLicenseSections(TEXT))
    expect(splitLicenseSections(crlf).sections.map((section) => section.title)).toEqual(['Graphify', 'Monaco Editor', 'd3'])

    open(vi.fn(async () => ({ text: crlf, path: 'C:\\x\\THIRD_PARTY_LICENSES.md' })))
    expect(await screen.findByRole('heading', { name: 'Graphify' })).toBeInTheDocument()
    expect(screen.getByText('3/3 mục')).toBeInTheDocument()
    for (const pre of document.querySelectorAll('pre')) expect(pre.textContent, pre.textContent ?? '').not.toContain('\r')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Tìm trong giấy phép' }), 'apache')
    expect(screen.getByText('1/3 mục')).toBeInTheDocument()
    expect([...document.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Apache'])
  })

  it('lỗi đọc tệp hiện thông báo thay vì màn hình trống', async () => {
    installNexgraph({ licenses: { read: vi.fn(async () => { throw Object.assign(new Error('Không đọc được tệp giấy phép mã nguồn mở đi kèm ứng dụng.'), { code: 'licenses_missing' }) }) } })
    render(<LicensesScreen onBack={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được tệp giấy phép mã nguồn mở đi kèm ứng dụng.')
  })

  it('lỗi đọc tệp ở UI English hiện câu English theo mã licenses_missing, không lộ câu Việt (B1)', async () => {
    setLocale('en')
    installNexgraph({ licenses: { read: vi.fn(async () => { throw Object.assign(new Error('Không đọc được tệp giấy phép mã nguồn mở đi kèm ứng dụng.'), { code: 'licenses_missing' }) }) } })
    render(<LicensesScreen onBack={vi.fn()} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not read the open source license file included with the app.')
    expect(alert.textContent).not.toMatch(/[ăâđêôơư]/i)
  })
})
