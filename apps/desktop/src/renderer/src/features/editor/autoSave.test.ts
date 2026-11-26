import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutoSave } from './autoSave'
import type { EditorPrefs } from '../../shared/lib/editorPrefs'

let prefs: Pick<EditorPrefs, 'autoSave' | 'autoSaveDelay'>
let writable: boolean
const save = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  save.mockClear()
  writable = true
  prefs = { autoSave: 'afterDelay', autoSaveDelay: 1000 }
})
afterEach(() => vi.useRealTimers())

describe('auto save scheduling', () => {
  it('waits for the last edit and saves only once', () => {
    const autoSave = createAutoSave(save, () => writable, () => prefs)
    autoSave.change()
    vi.advanceTimersByTime(700)
    autoSave.change()
    vi.advanceTimersByTime(999)
    expect(save).not.toHaveBeenCalled()
    autoSave.blur()
    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledOnce()
    autoSave.dispose()
  })

  it('never saves after becoming read-only, switching off, or disposal', () => {
    const autoSave = createAutoSave(save, () => writable, () => prefs)
    autoSave.change()
    writable = false
    vi.advanceTimersByTime(1000)
    writable = true
    autoSave.change()
    prefs.autoSave = 'off'
    vi.advanceTimersByTime(1000)
    prefs.autoSave = 'afterDelay'
    autoSave.change()
    autoSave.dispose()
    vi.advanceTimersByTime(1000)
    expect(save).not.toHaveBeenCalled()
  })

  it('saves on focus change only in that mode, and only if writable', () => {
    const autoSave = createAutoSave(save, () => writable, () => prefs)
    autoSave.blur()
    expect(save).not.toHaveBeenCalled()
    prefs.autoSave = 'onFocusChange'
    autoSave.change()
    vi.advanceTimersByTime(2000)
    expect(save).not.toHaveBeenCalled()
    autoSave.blur()
    expect(save).toHaveBeenCalledOnce()
    writable = false
    autoSave.blur()
    expect(save).toHaveBeenCalledOnce()
    autoSave.dispose()
  })
})
