export type ConflictChoice = 'ours' | 'theirs' | 'both'

export interface ConflictBlock {
  start: number
  end: number
  startLine: number
  endLine: number
  ours: string
  theirs: string
  original: string
}

interface PendingConflict {
  start: number
  startLine: number
  width: number
  oursStart: number
  oursEnd: number | null
  theirsStart: number | null
  phase: 'ours' | 'base' | 'theirs'
  invalid: boolean
  nested: number[]
}

/** Only complete, unambiguous Git conflicts are safe to resolve automatically. */
export function parseConflictBlocks(text: string): ConflictBlock[] {
  const blocks: ConflictBlock[] = []
  let pending: PendingConflict | null = null
  let offset = 0
  let line = 1

  while (offset < text.length) {
    const newline = text.indexOf('\n', offset)
    const end = newline < 0 ? text.length : newline + 1
    const contentEnd = newline < 0 ? end : newline > offset && text[newline - 1] === '\r' ? newline - 1 : newline
    const content = text.slice(offset, contentEnd)
    const marker = /^([<|=>])\1{6,}/.exec(content)
    if (marker) {
      const kind = marker[1]
      const width = marker[0].length
      const rest = content.slice(width)
      const valid = kind === '=' ? rest === '' : rest === '' || rest.startsWith(' ') || rest.startsWith('\t')

      if (!pending) {
        if (kind === '<') {
          pending = { start: offset, startLine: line, width, oursStart: end, oursEnd: null, theirsStart: null, phase: 'ours', invalid: !valid, nested: [] }
        }
      } else if (kind === '<') {
        pending.invalid = true
        pending.nested.push(width)
      } else if (kind === '>') {
        if (!valid) pending.invalid = true
        else if (pending.nested.length) {
          if (pending.nested[pending.nested.length - 1] === width) pending.nested.pop()
          else pending.invalid = true
        } else if (pending.width === width) {
          if (!pending.invalid && pending.phase === 'theirs' && pending.oursEnd !== null && pending.theirsStart !== null) {
            const ours = text.slice(pending.oursStart, pending.oursEnd)
            const theirs = text.slice(pending.theirsStart, offset)
            blocks.push({ start: pending.start, end, startLine: pending.startLine, endLine: line, ours, theirs, original: text.slice(pending.start, end) })
          }
          pending = null
        } else pending.invalid = true
      } else if (!pending.nested.length) {
        if (!valid || pending.width !== width) pending.invalid = true
        else if (kind === '|' && pending.phase === 'ours') {
          pending.oursEnd = offset
          pending.phase = 'base'
        } else if (kind === '=' && pending.phase !== 'theirs') {
          if (pending.phase === 'ours') pending.oursEnd = offset
          pending.theirsStart = end
          pending.phase = 'theirs'
        } else pending.invalid = true
      }
    }
    offset = end
    line++
  }
  return blocks
}

/** Stale or malformed blocks are left untouched rather than risking an edit to the wrong text. */
export function resolveConflictBlock(text: string, block: ConflictBlock, choice: ConflictChoice): string {
  const current = parseConflictBlocks(text).find((candidate) =>
    candidate.start === block.start && candidate.end === block.end && candidate.original === block.original)
  if (!current) return text
  if (choice !== 'ours' && choice !== 'theirs' && choice !== 'both') return text
  let replacement = choice === 'ours' ? current.ours : choice === 'theirs' ? current.theirs : current.ours + current.theirs
  if (current.end === text.length && !current.original.endsWith('\n')) replacement = replacement.replace(/\r?\n$/, '')
  return text.slice(0, current.start) + replacement + text.slice(current.end)
}
