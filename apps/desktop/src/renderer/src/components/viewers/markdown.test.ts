import { describe, expect, it } from 'vitest'
import { resolveReference, taskEdit } from './markdown'

describe('Markdown preview references', () => {
  it('resolves relative and project-root paths, decoding URL escapes and retaining fragments', () => {
    expect(resolveReference('docs/guide/readme.md', '../img/a%20b.png?raw=1')).toEqual({ kind: 'file', file: 'docs/img/a b.png', fragment: '' })
    expect(resolveReference('docs/guide/readme.md', '/img/a.png')).toEqual({ kind: 'file', file: 'img/a.png', fragment: '' })
    expect(resolveReference('docs/guide/readme.md', './other.md#heading')).toEqual({ kind: 'file', file: 'docs/guide/other.md', fragment: 'heading' })
    expect(resolveReference('docs/guide/readme.md', '#heading')).toEqual({ kind: 'fragment', fragment: 'heading' })
  })
  it('rejects paths escaping the project and unsafe schemes', () => {
    expect(resolveReference('docs/readme.md', '../../private.png')).toBeNull()
    expect(resolveReference('docs/readme.md', '%2e%2e/%2e%2e/private.png')).toBeNull()
    expect(resolveReference('README.md', 'javascript:alert(1)')).toBeNull()
    expect(resolveReference('README.md', 'https://example.com/doc')).toEqual({ kind: 'external', url: 'https://example.com/doc' })
  })
})

describe('Markdown task edit', () => {
  it('edits only the task marker at the list item position', () => {
    expect(taskEdit('intro\n- [ ] one\n  - [X] two', 2, 1, true)).toEqual({ line: 2, startColumn: 3, endColumn: 6, text: '[x]' })
    expect(taskEdit('intro\n- [ ] one\n  - [X] two', 3, 3, false)).toEqual({ line: 3, startColumn: 5, endColumn: 8, text: '[ ]' })
    expect(taskEdit('> 1. [ ] quoted', 1, 3, true)).toEqual({ line: 1, startColumn: 6, endColumn: 9, text: '[x]' })
  })
  it('ignores text that is no longer a task marker', () => {
    expect(taskEdit('- hello [ ]', 1, 1, true)).toBeNull()
    expect(taskEdit('- [x] already checked', 1, 1, true)).toBeNull()
    expect(taskEdit('- [ ] broken', 2, 1, true)).toBeNull()
  })
})
