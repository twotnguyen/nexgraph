import type { BlockKind } from '@shared/graph-types'

const COLORS: Record<BlockKind, string> = {
  directory: '#1f5fbf',
  community: '#6a4fb3',
  file: '#5b6b7d',
  group: '#b86e00'
}

export const blockColor = (kind: BlockKind): string => COLORS[kind]
