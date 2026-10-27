import { join } from 'node:path'
import { expect, it } from 'vitest'
import { resolveEngineCommand } from '../src/main/engine/resolve-command'

it('packaged darwin', () =>
  expect(resolveEngineCommand({ isPackaged: true, resourcesPath: '/R', repoRoot: '/X', platform: 'darwin' })).toEqual({
    command: join('/R', 'engine', 'nexgraph-engine'),
    args: []
  }))

it('packaged win32', () =>
  expect(
    resolveEngineCommand({ isPackaged: true, resourcesPath: 'C:\\R', repoRoot: 'C:\\X', platform: 'win32' }).command
  ).toBe(join('C:\\R', 'engine', 'nexgraph-engine.exe')))

it('dev uses uv', () =>
  expect(resolveEngineCommand({ isPackaged: false, resourcesPath: '', repoRoot: '/X' })).toEqual({
    command: 'uv',
    args: ['run', '--project', join('/X', 'engine'), 'nexgraph-engine']
  }))
