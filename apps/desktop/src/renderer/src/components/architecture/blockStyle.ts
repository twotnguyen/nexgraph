import type { BlockKind } from '@shared/graph-types'

const COLORS: Record<BlockKind, string> = {
  directory: 'var(--blue)',
  community: 'var(--violet)',
  file: 'var(--teal)',
  group: 'var(--orange)'
}

export const blockColor = (kind: BlockKind): string => COLORS[kind]
