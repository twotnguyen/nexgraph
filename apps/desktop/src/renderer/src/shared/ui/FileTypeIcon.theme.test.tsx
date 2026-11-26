// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { setEditorPrefs } from '../lib/editorPrefs'
import { FileTypeIcon } from './FileTypeIcon'

afterEach(() => { cleanup(); setEditorPrefs({ iconTheme: 'symbols' }) })

it('switches every file icon between coloured and monochrome themes live', () => {
  const { container } = render(<><FileTypeIcon name="src/app.ts" /><FileTypeIcon name="README.md" /></>)
  expect(container.querySelectorAll('img')).toHaveLength(2)
  act(() => setEditorPrefs({ iconTheme: 'mono' }))
  expect(container.querySelectorAll('img')).toHaveLength(0)
  expect(container.querySelectorAll('svg[stroke="currentColor"]')).toHaveLength(2)
  act(() => setEditorPrefs({ iconTheme: 'symbols' }))
  expect(container.querySelectorAll('img')).toHaveLength(2)
})
