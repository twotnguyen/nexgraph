import type { NexRuntimeConfig } from './nex-runtime.mjs'

export type RmOptions = { recursive?: boolean; force?: boolean; maxRetries?: number; retryDelay?: number }
export type MoveDeps = {
  rename?: (from: string, to: string) => void
  copyFile?: (from: string, to: string) => void
  rm?: (path: string, options?: RmOptions) => void
}
export type FetchDeps = MoveDeps & {
  download?: (url: string, dest: string) => Promise<void>
  extract?: (zip: string, destDir: string) => void
}

export function download(url: string, dest: string): Promise<void>
export function extract(zip: string, destDir: string): void
export function findBinary(dir: string, name: string): string | null
export function moveFileVerified(
  src: string,
  dest: string,
  expectedSha256: string,
  label: string,
  deps?: MoveDeps
): Promise<'rename' | 'copy'>
export function fetchNexRuntime(o: {
  config: NexRuntimeConfig
  platform?: NodeJS.Platform
  arch?: string
  out: string
  log?: (line: string) => void
  deps?: FetchDeps
}): Promise<{ status: 'current' | 'fetched'; key: string; dest: string; placed?: 'rename' | 'copy' }>
