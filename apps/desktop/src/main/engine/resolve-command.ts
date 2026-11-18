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
  // Chạy module Python trực tiếp để dev dùng cùng đường chạy trên Windows và macOS.
  return { command: 'uv', args: ['run', '--project', join(o.repoRoot, 'engine'), '--locked', 'python', '-m', 'nexgraph_engine.cli'] }
}
