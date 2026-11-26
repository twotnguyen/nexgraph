import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldIgnore } from '../src/main/platform/ignore'
import { ProjectWatcher } from '../src/main/features/indexing/project-watcher'

class FakeFsWatcher extends EventEmitter {
  closed = false
  close(): void {
    this.closed = true
  }
}

function setup(onFlush: () => Promise<void | 'retry'>, extra: { onError?: (e: Error) => void } = {}) {
  let listener: (event: string, name: string | null) => void = () => {}
  const fsw = new FakeFsWatcher()
  const watch = vi.fn((_root: string, _opts: unknown, cb: typeof listener) => {
    listener = cb
    return fsw
  })
  const w = new ProjectWatcher({ root: '/Đồ án/demo', onFlush, watch: watch as never, ...extra })
  w.start()
  return { w, fsw, emit: (name: string | null) => listener('change', name), watch }
}

describe('shouldIgnore', () => {
  it('ignores build outputs, tool folders and git internals but keeps HEAD and refs', () => {
    for (const p of ['.nexgraph/graph.db', 'build/x.dart', 'a/.dart_tool/package_config.json', 'node_modules/x/y.js',
      '.idea/workspace.xml', 'ios/ephemeral/a', '.git/objects/ab/cdef', '.git/index', '.git/HEAD.lock', 'build\\x.dart',
      '.nexgraph\\graph.db-wal', './build/x.dart']) {
      expect(shouldIgnore(p), p).toBe(true)
    }
    for (const p of ['lib/a.dart', '.git/HEAD', '.git/refs/heads/main', '.gitignore', 'lib/màn hình/đăng nhập.dart',
      'src\\app.ts', 'lib/builder.dart']) {
      expect(shouldIgnore(p), p).toBe(false)
    }
  })
})

describe('shouldIgnore temp files of fs.write', () => {
  it('ignores .<name>.<uuid>.tmp beside the target but not ordinary tmp files', () => {
    const tmp = '.a.dart.3f2b8c1e-5d4a-4e7b-9c0d-1a2b3c4d5e6f.tmp'
    expect(shouldIgnore(`lib/${tmp}`)).toBe(true)
    expect(shouldIgnore(`lib\\${tmp}`)).toBe(true)
    expect(shouldIgnore('lib/notes.tmp')).toBe(false)
    expect(shouldIgnore('lib/.hidden.tmp')).toBe(false)
  })
})

describe('ProjectWatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('5,000 events in one second cause exactly one flush', async () => {
    const onFlush = vi.fn(async () => {})
    const { emit } = setup(onFlush)
    for (let i = 0; i < 5000; i++) {
      emit(`lib/f${i}.dart`)
      if (i % 500 === 0) await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(600)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('flushes at maxWait during continuous events instead of waiting for the end', async () => {
    const onFlush = vi.fn(async () => {})
    const { emit } = setup(onFlush)
    for (let t = 0; t < 10_000; t += 100) {
      emit('lib/a.dart')
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(onFlush.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(onFlush.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('events during a running flush rerun exactly once afterwards', async () => {
    let release: () => void = () => {}
    const onFlush = vi.fn(() => new Promise<void>((r) => (release = r)))
    const { emit } = setup(onFlush)
    emit('lib/a.dart')
    await vi.advanceTimersByTimeAsync(600)
    expect(onFlush).toHaveBeenCalledTimes(1)
    emit('lib/b.dart')
    emit('lib/c.dart')
    emit('lib/d.dart')
    await vi.advanceTimersByTimeAsync(2000)
    expect(onFlush).toHaveBeenCalledTimes(1) // vẫn đang chạy: không chạy chồng
    release()
    await vi.advanceTimersByTimeAsync(0)
    onFlush.mockImplementation(async () => {})
    await vi.advanceTimersByTimeAsync(2000)
    expect(onFlush).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(onFlush).toHaveBeenCalledTimes(2)
  })

  it('a failing flush reports the error and keeps watching', async () => {
    const onError = vi.fn()
    const onFlush = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const { emit } = setup(onFlush, { onError })
    emit('lib/a.dart')
    await vi.advanceTimersByTimeAsync(600)
    expect(onError).toHaveBeenCalledTimes(1)
    emit('lib/a.dart')
    await vi.advanceTimersByTimeAsync(600)
    expect(onFlush).toHaveBeenCalledTimes(2)
  })

  it('retries a change skipped while the engine is publishing without another file event', async () => {
    const onFlush = vi.fn<() => Promise<void | 'retry'>>().mockResolvedValueOnce('retry').mockResolvedValue(undefined)
    const { emit } = setup(onFlush)
    emit('lib/a.dart')
    await vi.advanceTimersByTimeAsync(600)
    expect(onFlush).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1600)
    expect(onFlush).toHaveBeenCalledTimes(2)
  })

  it('stop cancels a pending flush and closes the watcher', async () => {
    const onFlush = vi.fn(async () => {})
    const { w, emit, fsw } = setup(onFlush)
    emit('lib/a.dart')
    w.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(onFlush).not.toHaveBeenCalled()
    expect(fsw.closed).toBe(true)
    emit('lib/a.dart')
    await vi.advanceTimersByTimeAsync(5000)
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('events only in ignored paths never flush; .git/HEAD does', async () => {
    const onFlush = vi.fn(async () => {})
    const { emit } = setup(onFlush)
    for (const p of ['.git/objects/aa/bb', 'build/x.dart', '.nexgraph/graph.db-wal', '.dart_tool/x']) emit(p)
    await vi.advanceTimersByTimeAsync(5000)
    expect(onFlush).not.toHaveBeenCalled()
    emit('.git/HEAD')
    await vi.advanceTimersByTimeAsync(600)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('a null filename (platform did not say what changed) counts as a change', async () => {
    const onFlush = vi.fn(async () => {})
    const { emit } = setup(onFlush)
    emit(null)
    await vi.advanceTimersByTimeAsync(600)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('watches the root recursively and reports watcher errors', () => {
    const onError = vi.fn()
    const { watch, fsw } = setup(async () => {}, { onError })
    expect(watch.mock.calls[0][0]).toBe('/Đồ án/demo')
    expect(watch.mock.calls[0][1]).toMatchObject({ recursive: true })
    fsw.emit('error', new Error('EMFILE'))
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
