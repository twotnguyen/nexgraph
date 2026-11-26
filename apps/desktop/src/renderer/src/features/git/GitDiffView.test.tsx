// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitDiffView } from './GitDiffView'

vi.mock('../editor/monaco', () => ({
  createDiffEditor: vi.fn(() => ({ dispose: vi.fn() })),
  languageFor: vi.fn(() => 'typescript')
}))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const oldSha = 'a'.repeat(40)
const newSha = 'b'.repeat(40)

function setup() {
  const diff = vi.fn(async (_pid: string, _file: string, _staged: boolean, _base?: string) => ({ before: 'cũ', after: 'mới' }))
  const hunks = vi.fn(async () => [{ id: 'h1', header: '@@ -1 +1 @@', oldStart: 1, newStart: 1 }])
  const history = vi.fn(async () => [
    { sha: oldSha, parents: [], subject: 'đầu tiên', author: 'A', time: 1, refs: '' },
    { sha: newSha, parents: [], subject: 'sau đó', author: 'A', time: 2, refs: '' }
  ])
  Object.assign(window, { nexgraph: { git: { diff, hunks, history }, index: { onEvent: () => () => {} } } })
  render(<GitDiffView projectId="p1" file="src/a.ts" staged={false} onClose={() => {}} onOpenFile={() => {}} />)
  return { diff, hunks, history }
}

describe('GitDiffView base', () => {
  it('chọn base từ lịch sử thì gọi diff với base và không vẽ hunk bar', async () => {
    const { diff, hunks } = setup()
    expect(await screen.findByRole('option', { name: `${oldSha.slice(0, 7)} đầu tiên` })).toBeTruthy()
    await screen.findByRole('button', { name: /Stage khối/ })
    expect(diff).toHaveBeenLastCalledWith('p1', 'src/a.ts', false, undefined)
    expect(hunks).toHaveBeenCalledWith('p1', 'src/a.ts', false)

    fireEvent.change(screen.getByRole('combobox', { name: 'Base để so sánh' }), { target: { value: newSha } })
    await waitFor(() => expect(diff).toHaveBeenLastCalledWith('p1', 'src/a.ts', false, newSha))
    expect(screen.queryByRole('button', { name: /Stage khối/ })).toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: 'Base để so sánh' }), { target: { value: '' } })
    await waitFor(() => expect(diff).toHaveBeenLastCalledWith('p1', 'src/a.ts', false, undefined))
    expect(await screen.findByRole('button', { name: /Stage khối/ })).toBeTruthy()
  })

})
