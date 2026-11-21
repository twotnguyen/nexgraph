// @vitest-environment jsdom
import { createElement } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GitCommit, GitFileChange } from '@shared/api'
import { GitHistory } from './GitHistory'
import { assignLanes } from './graph'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('assignLanes', () => {
  it('draws a linear history from the tip to the root', () => {
    expect(assignLanes([
      { sha: 'a', parents: ['b'] },
      { sha: 'b', parents: ['c'] },
      { sha: 'c', parents: [] }
    ])).toEqual([
      { lane: 0, incoming: false, through: [], parents: [0], outgoing: 1, width: 1 },
      { lane: 0, incoming: true, through: [], parents: [0], outgoing: 1, width: 1 },
      { lane: 0, incoming: true, through: [], parents: [], outgoing: 0, width: 1 }
    ])
  })

  it('splits both merge parents, carries the other branch and rejoins their shared ancestor', () => {
    expect(assignLanes([
      { sha: 'merge', parents: ['main', 'feature'] },
      { sha: 'feature', parents: ['base'] },
      { sha: 'main', parents: ['base'] },
      { sha: 'base', parents: [] }
    ])).toEqual([
      { lane: 0, incoming: false, through: [], parents: [0, 1], outgoing: 2, width: 2 },
      { lane: 1, incoming: true, through: [{ from: 0, to: 0 }], parents: [1], outgoing: 2, width: 2 },
      { lane: 0, incoming: true, through: [{ from: 1, to: 0 }], parents: [0], outgoing: 1, width: 2 },
      { lane: 0, incoming: true, through: [], parents: [], outgoing: 0, width: 1 }
    ])
  })

  it('keeps an unseen parent as an outgoing lane when history is truncated', () => {
    expect(assignLanes([
      { sha: 'a', parents: ['not-loaded'] },
      { sha: 'other', parents: ['not-loaded'] }
    ])).toEqual([
      { lane: 0, incoming: false, through: [], parents: [0], outgoing: 1, width: 1 },
      { lane: 1, incoming: false, through: [{ from: 0, to: 0 }], parents: [0], outgoing: 1, width: 2 }
    ])
    expect(assignLanes([])).toEqual([])
  })
})

afterEach(() => vi.unstubAllGlobals())
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

it('ignores stale project and file requests, opens the selected historical diff, and loads all branches in graph mode', async () => {
  const oldCommit: GitCommit = { sha: 'old', parents: [], subject: 'Old project', author: 'An', time: 1, refs: '' }
  const first: GitCommit = { sha: 'first', parents: [], subject: 'First commit', author: 'An', time: 2, refs: '' }
  const second: GitCommit = { sha: 'second', parents: [], subject: 'Second commit', author: 'Bình', time: 3, refs: 'main' }
  const oldHistory = deferred<GitCommit[]>()
  const oldFiles = deferred<GitFileChange[]>()
  const history = vi.fn((project: string, _all: boolean) => project === 'old' ? oldHistory.promise : Promise.resolve([first, second]))
  const commitFiles = vi.fn((_project: string, sha: string) => sha === first.sha
    ? oldFiles.promise : Promise.resolve([{ path: 'new.txt', status: 'R', from: 'old.txt' }]))
  vi.stubGlobal('nexgraph', { git: { history, commitFiles } })
  const onOpenDiff = vi.fn()
  const view = render(createElement(GitHistory, { projectId: 'old', onOpenDiff }))
  view.rerender(createElement(GitHistory, { projectId: 'new', onOpenDiff }))
  await screen.findByText('First commit')
  await act(async () => { oldHistory.resolve([oldCommit]) })
  expect(screen.queryByText('Old project')).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /First commit/ }))
  await userEvent.click(screen.getByRole('button', { name: /Second commit/ }))
  await screen.findByText('new.txt')
  await act(async () => { oldFiles.resolve([{ path: 'stale.txt', status: 'M' }]) })
  expect(screen.queryByText('stale.txt')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /new.txt/ }))
  expect(onOpenDiff).toHaveBeenCalledWith('new.txt', false, 'second', 'old.txt')

  await userEvent.click(screen.getByRole('button', { name: 'Đồ thị' }))
  await screen.findByText('First commit')
  expect(history).toHaveBeenLastCalledWith('new', true)
  expect(view.container.querySelector('.git-history-graph')).not.toBeNull()
})
