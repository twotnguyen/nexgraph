export const REQUIRED_LICENSE_FILES: readonly string[]
export function resourcesDir(appDir: string, platform?: NodeJS.Platform): string
export function missingLicenseFiles(appDir: string, platform?: NodeJS.Platform): string[]
export function assertLicenseFiles(appDir: string, platform?: NodeJS.Platform): void
