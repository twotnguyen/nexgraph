export type NexRuntimeAsset = {
  url: string
  filename: string
  sha256: string
  binarySha256: string
  bytes: number
  binary: string
}
export type NexRuntimeConfig = {
  version: string
  source: string
  assets: Record<string, NexRuntimeAsset>
}
export const NEX_RUNTIME_CONFIG: string
export const NEX_RUNTIME_SUPPORTED: readonly string[]
export function loadNexRuntime(file?: string): NexRuntimeConfig
export function platformKey(platform?: NodeJS.Platform, arch?: string): string
export function platformOs(key: string): NodeJS.Platform
export function binaryName(platform?: NodeJS.Platform): string
export function runtimeBinaryPath(dir: string, platform?: NodeJS.Platform): string
export function assetFor(config: NexRuntimeConfig, platform?: NodeJS.Platform, arch?: string): NexRuntimeAsset
export function sha256File(path: string): Promise<string>
export function assertSha256(actual: string, expected: string, label?: string): void
export function isRuntimeCurrent(path: string, expectedSha256: string): Promise<boolean>
export function packagedBinaryPath(appDir: string, platform?: NodeJS.Platform): string
export function assertPackagedNexRuntime(o: {
  appDir: string
  platform?: NodeJS.Platform
  file?: string
  log?: (line: string) => void
}): Promise<string>
export function assertNoNexBinaryInAsar(appDir: string, platform?: NodeJS.Platform): void
