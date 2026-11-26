import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EditorStateRegistry } from '../src/main/features/agent/editor-state'

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ng-edit-state-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.ts'), 'source')
  return root
}

describe('editor state barrier', () => {
  it('waits for dirty-path validation before approving a write and canonicalizes duplicate paths', async () => {
    const root = fixture()
    let resolve!: (root: string) => void
    const states = new EditorStateRegistry(() => new Promise((done) => { resolve = done }))
    const update = states.update('p1', [{ file: './src/a.ts', dirty: true }, { file: 'src/a.ts', dirty: false }])
    const afterBarrier = vi.fn()
    const approval = states.wait('p1').then(() => afterBarrier(states.get('p1')))
    await Promise.resolve()
    expect(() => states.get('p1')).toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(afterBarrier).not.toHaveBeenCalled()
    resolve(root)
    await Promise.all([update, approval])
    expect(afterBarrier).toHaveBeenCalledWith([{ file: 'src/a.ts', dirty: true }])
  })

  it('keeps the latest update when root lookups finish out of order', async () => {
    const root = fixture()
    const requests: ((root: string) => void)[] = []
    const states = new EditorStateRegistry(() => new Promise((done) => requests.push(done)))
    const old = states.update('p1', [{ file: 'src/a.ts', dirty: false }])
    const latest = states.update('p1', [{ file: 'src/a.ts', dirty: true }])
    requests[1](root)
    await latest
    await states.wait('p1')
    requests[0](root)
    await old
    expect(states.get('p1')[0].dirty).toBe(true)
  })

  it('invalid updates fail closed until a valid update replaces them', async () => {
    const root = fixture()
    const states = new EditorStateRegistry(async () => root)
    await expect(states.update('p1', [{ file: '../outside.ts', dirty: false }])).rejects.toMatchObject({ code: 'outside_project' })
    await expect(states.wait('p1')).rejects.toMatchObject({ code: 'outside_project' })
    expect(() => states.get('p1')).toThrow(expect.objectContaining({ code: 'outside_project' }))
    await states.update('p1', [{ file: 'src/a.ts', dirty: false }])
    await states.wait('p1')
    expect(states.get('p1')[0]).toMatchObject({ dirty: false })
  })

  it('closing a project invalidates waiting approvals and late updates', async () => {
    const root = fixture()
    let resolve!: (root: string) => void
    const states = new EditorStateRegistry(() => new Promise((done) => { resolve = done }))
    const update = states.update('p1', [{ file: 'src/a.ts', dirty: true }])
    const approval = states.wait('p1')
    states.clear('p1')
    resolve(root)
    await update
    await expect(approval).rejects.toMatchObject({ code: 'conflict' })
    expect(states.get('p1')).toEqual([])
  })
})
