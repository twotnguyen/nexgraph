import type { BlockKind } from '@shared/graph-types'

const COLORS: Record<BlockKind, string> = {
  directory: '#3257f0',
  community: '#7a4df2',
  file: '#0a9c99',
  group: '#e07a00'
}

export const blockColor = (kind: BlockKind): string => COLORS[kind]
