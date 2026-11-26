export const IMPORT_LINTER: string
export const DEPENDENCY_CRUISER: string
export function parseImportLinter(out: string): { kept: number; broken: number; violations: number } | null
export function parseDepcruise(out: string): { violations: number; errors: number; warnings: number; modules: number | null } | null
