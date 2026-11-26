import { expect, it } from 'vitest'
import { fileIconName } from './FileTypeIcon'

it('picks file icons by exact name, then the longest suffix', () => {
  expect(fileIconName('apps/desktop/package.json')).toBe('node')
  expect(fileIconName('src/env.d.ts')).toBe('ts-types')
  expect(fileIconName('src/App.TSX')).toBe('react-ts')
  expect(fileIconName('.gitignore')).toBe('git')
  expect(fileIconName('.hidden')).toBe('default')
  expect(fileIconName('Makefile.local')).toBe('default')
})
