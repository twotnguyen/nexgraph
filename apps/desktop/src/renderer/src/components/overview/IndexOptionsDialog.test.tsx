// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { IndexOptionsDialog } from './IndexOptionsDialog'

describe('IndexOptionsDialog', () => {
  it('mặc định: số tiến trình tự chọn, không index lại từ đầu, không gồm tệp cấu hình', async () => {
    installNexgraph()
    const onSubmit = vi.fn()
    render(<IndexOptionsDialog projectId="p1" onSubmit={onSubmit} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Index lại với tuỳ chọn này' }))
    expect(onSubmit).toHaveBeenCalledWith({ exclude: [], includeDocs: false, includeMedia: false, includeConfig: false, force: false,
      sources: { postgres: false, cargo: false, manifests: false, scipFiles: [], mcpFiles: [] } })
  })

  it('gửi số tiến trình, index lại từ đầu và tệp cấu hình khi người dùng chọn', async () => {
    installNexgraph()
    const onSubmit = vi.fn()
    render(<IndexOptionsDialog projectId="p1" onSubmit={onSubmit} onClose={() => {}} />)
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Số tiến trình' }), '2')
    await userEvent.click(screen.getByRole('checkbox', { name: /Index lại từ đầu/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Tệp cấu hình/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Index lại với tuỳ chọn này' }))
    expect(onSubmit).toHaveBeenCalledWith({ exclude: [], includeDocs: false, includeMedia: false, includeConfig: true, force: true, workers: 2,
      sources: { postgres: false, cargo: false, manifests: false, scipFiles: [], mcpFiles: [] } })
  })

  it('chỉ dẫn ánh xạ đuôi tệp qua .graphifyrc', () => {
    installNexgraph()
    render(<IndexOptionsDialog projectId="p1" onSubmit={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/\.graphifyrc/)).toBeInTheDocument()
  })

  describe('Nguồn bổ sung (W11)', () => {
    it('bật Cargo và thêm tệp SCIP qua hộp chọn tệp thì gửi sources', async () => {
      installNexgraph({ indexSources: { pickFile: vi.fn(async () => '/Đồ án/index.scip.json') } })
      const onSubmit = vi.fn()
      render(<IndexOptionsDialog projectId="p1" onSubmit={onSubmit} onClose={() => {}} />)
      await userEvent.click(screen.getByText('Nguồn bổ sung (nâng cao)'))
      await userEvent.click(screen.getByRole('checkbox', { name: /Cargo workspace/ }))
      await userEvent.click(screen.getByRole('button', { name: /Thêm tệp SCIP/ }))
      expect(screen.getByRole('textbox', { name: /Tệp SCIP/ })).toHaveValue('/Đồ án/index.scip.json')
      await userEvent.click(screen.getByRole('button', { name: 'Index lại với tuỳ chọn này' }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        sources: { postgres: false, cargo: true, manifests: false, scipFiles: ['/Đồ án/index.scip.json'], mcpFiles: [] }
      }))
    })

    it('DSN gửi thẳng xuống main, không nằm trong tuỳ chọn index', async () => {
      const { api } = installNexgraph({ engine: { tools: vi.fn(async () => ({ psycopg: true })) } })
      const onSubmit = vi.fn()
      render(<IndexOptionsDialog projectId="p1" onSubmit={onSubmit} onClose={() => {}} />)
      await userEvent.click(screen.getByText('Nguồn bổ sung (nâng cao)'))
      await userEvent.click(await screen.findByRole('checkbox', { name: /PostgreSQL/ }))
      const submit = screen.getByRole('button', { name: 'Index lại với tuỳ chọn này' })
      expect(submit).toBeDisabled()
      await userEvent.type(screen.getByLabelText(/Chuỗi kết nối/), 'postgresql://u:pw@h/db')
      await userEvent.click(submit)
      expect(api.indexSources.saveDsn).toHaveBeenCalledWith('p1', 'postgresql://u:pw@h/db')
      expect(JSON.stringify(onSubmit.mock.calls)).not.toContain('pw@h')
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sources: expect.objectContaining({ postgres: true }) }))
    })

    it('hiện lại nguồn đã nhớ của dự án', async () => {
      installNexgraph({ indexSources: { remembered: vi.fn(async () => ({ cargo: true, mcpFiles: ['/a/.mcp.json'] })) } })
      render(<IndexOptionsDialog projectId="p1" onSubmit={() => {}} onClose={() => {}} />)
      expect(await screen.findByRole('checkbox', { name: /Cargo workspace/ })).toBeChecked()
      expect(screen.getByRole('textbox', { name: /Tệp cấu hình MCP/ })).toHaveValue('/a/.mcp.json')
    })

    it('lưu DSN lỗi thì báo lỗi và không index', async () => {
      installNexgraph({ engine: { tools: vi.fn(async () => ({ psycopg: true })) },
        indexSources: { saveDsn: vi.fn(async () => { throw new Error('no_keychain') }) } })
      const onSubmit = vi.fn()
      render(<IndexOptionsDialog projectId="p1" onSubmit={onSubmit} onClose={() => {}} />)
      await userEvent.click(await screen.findByRole('checkbox', { name: /PostgreSQL/ }))
      const dsn = screen.getByLabelText(/Chuỗi kết nối/)
      expect(dsn).toHaveAttribute('placeholder', 'postgresql://user@host:5432/db')
      await userEvent.type(dsn, 'host=h')
      await userEvent.click(screen.getByRole('button', { name: 'Index lại với tuỳ chọn này' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Không lưu được chuỗi kết nối')
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('thiếu psycopg thì khoá PostgreSQL', async () => {
      installNexgraph({ engine: { tools: vi.fn(async () => ({ psycopg: false })) } })
      render(<IndexOptionsDialog projectId="p1" onSubmit={() => {}} onClose={() => {}} />)
      await userEvent.click(screen.getByText('Nguồn bổ sung (nâng cao)'))
      expect(await screen.findByText(/Cần cài psycopg/)).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: /PostgreSQL/ })).toBeDisabled()
    })
  })
})
