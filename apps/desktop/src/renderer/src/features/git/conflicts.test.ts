import { describe, expect, it } from 'vitest'
import { parseConflictBlocks, resolveConflictBlock } from './conflicts'

const conflict = 'trước\n<<<<<<< HEAD\ncủa mình\n=======\ncủa họ\n>>>>>>> nhánh\nsau\n'

describe('Git conflict blocks', () => {
  it.each([
    ['ours', 'trước\ncủa mình\nsau\n'],
    ['theirs', 'trước\ncủa họ\nsau\n'],
    ['both', 'trước\ncủa mình\ncủa họ\nsau\n']
  ] as const)('resolves %s without changing surrounding text', (choice, expected) => {
    const blocks = parseConflictBlocks(conflict)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].startLine).toBe(2)
    expect(blocks[0].endLine).toBe(6)
    expect(resolveConflictBlock(conflict, blocks[0], choice)).toBe(expected)
  })

  it.each([
    ['ours', 'mới\n'],
    ['theirs', 'bên kia\n'],
    ['both', 'mới\nbên kia\n']
  ] as const)('omits the diff3 base when resolving %s', (choice, expected) => {
    const text = '<<<<<<< HEAD\nmới\n||||||| gốc\ncũ\n=======\nbên kia\n>>>>>>> branch\n'
    const blocks = parseConflictBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(resolveConflictBlock(text, blocks[0], choice)).toBe(expected)
  })

  it('resolves only the selected block and reparses shifted blocks', () => {
    const text = '<<<<<<< A\na\n=======\nb\n>>>>>>> B\nở giữa\n<<<<<<< C\nc\n=======\nd\n>>>>>>> D\n'
    const blocks = parseConflictBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[1].startLine).toBe(7)
    const next = resolveConflictBlock(text, blocks[0], 'theirs')
    expect(next).toBe('b\nở giữa\n<<<<<<< C\nc\n=======\nd\n>>>>>>> D\n')
    expect(resolveConflictBlock(next, blocks[1], 'ours')).toBe(next)
    const remaining = parseConflictBlocks(next)
    expect(remaining[0].startLine).toBe(3)
    expect(resolveConflictBlock(next, remaining[0], 'ours')).toBe('b\nở giữa\nc\n')
  })

  it('preserves CRLF and an absent final newline for all choices', () => {
    const text = 'đầu\r\n<<<<<<< HEAD\r\nmình\r\n=======\r\nhọ\r\n>>>>>>> nhánh'
    const [block] = parseConflictBlocks(text)
    expect(resolveConflictBlock(text, block, 'ours')).toBe('đầu\r\nmình')
    expect(resolveConflictBlock(text, block, 'theirs')).toBe('đầu\r\nhọ')
    expect(resolveConflictBlock(text, block, 'both')).toBe('đầu\r\nmình\r\nhọ')
  })

  it('handles empty sides and unlabeled markers', () => {
    const text = '<<<<<<<\n=======\nkhác\n>>>>>>>\n'
    const [block] = parseConflictBlocks(text)
    expect(resolveConflictBlock(text, block, 'ours')).toBe('')
    expect(resolveConflictBlock(text, block, 'theirs')).toBe('khác\n')
    expect(resolveConflictBlock(text, block, 'both')).toBe('khác\n')
  })

  it('handles Git markers configured longer than seven characters', () => {
    const text = '<<<<<<<< HEAD\nmình\n========\nhọ\n>>>>>>>> branch\n'
    const blocks = parseConflictBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(resolveConflictBlock(text, blocks[0], 'both')).toBe('mình\nhọ\n')
  })

  it.each([
    '<<<<<<< HEAD\nmình\n=======\nhọ\n',
    '<<<<<<< HEAD\nmình\n>>>>>>> branch\n',
    '<<<<<<< HEAD\nmình\n=======\nhọ\n=======\nthêm\n>>>>>>> branch\n',
    '<<<<<<< HEAD\nmình\n||||||| base\ncũ\n||||||| base khác\ncũ nữa\n=======\nhọ\n>>>>>>> branch\n',
    '<<<<<<< HEAD\nmình\n=======\nhọ\n||||||| base\ncũ\n>>>>>>> branch\n',
    '<<<<<<< HEAD\nmình\n======= label\nhọ\n>>>>>>> branch\n',
    '<<<<<<< HEAD\nmình\n========\nhọ\n>>>>>>> branch\n'
  ])('ignores malformed or incomplete conflict markers: %s', (text) => {
    expect(parseConflictBlocks(text)).toEqual([])
  })

  it('does not offer to resolve any part of a nested conflict, but finds a later independent block', () => {
    const text = '<<<<<<< outer\na\n<<<<<<< inner\nb\n=======\nc\n>>>>>>> inner\n=======\nd\n>>>>>>> outer\n<<<<<<< next\ne\n=======\nf\n>>>>>>> end\n'
    const blocks = parseConflictBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].startLine).toBe(11)
    expect(resolveConflictBlock(text, blocks[0], 'ours')).toBe('<<<<<<< outer\na\n<<<<<<< inner\nb\n=======\nc\n>>>>>>> inner\n=======\nd\n>>>>>>> outer\ne\n')
  })

  it('refuses a stale block even when an edit keeps its offsets unchanged', () => {
    const [block] = parseConflictBlocks(conflict)
    const changed = conflict.replace('của mình', 'của MÌNH')
    expect(resolveConflictBlock(changed, block, 'ours')).toBe(changed)
  })

  it('does not treat indented or inline marker-like text as a conflict', () => {
    expect(parseConflictBlocks('  <<<<<<< HEAD\na = "======="\n  >>>>>>> branch\n')).toEqual([])
  })
})
