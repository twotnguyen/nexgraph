import { join } from 'node:path'
import type { EngineCommand } from './launcher'

export function resolveEngineCommand(o: {
  isPackaged: boolean
  resourcesPath: string
  repoRoot: string
  platform?: NodeJS.Platform
}): EngineCommand {
  if (o.isPackaged) {
    const exe = (o.platform ?? process.platform) === 'win32' ? 'nexgraph-engine.exe' : 'nexgraph-engine'
    return { command: join(o.resourcesPath, 'engine', exe), args: [] }
  }
  // Lúc dev: chạy engine từ mã nguồn bằng uv.
  return { command: 'uv', args: ['run', '--project', join(o.repoRoot, 'engine'), 'nexgraph-engine'] }
}
