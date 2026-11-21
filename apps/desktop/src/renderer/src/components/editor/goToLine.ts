export function parseGoToLine(input: string, current: number, lineCount: number): { line: number; column: number } | null {
  const match = /^([+\-fFbB]?)(\d+)(?::(\d+))?$/.exec(input.trim())
  if (!match) return null
  const value = Number(match[2])
  const column = Number(match[3] ?? 1)
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(column) || column < 1 || (!match[1] && value < 1)) return null
  const relative = match[1] ? current + (/[\-bB]/.test(match[1]) ? -value : value) : value
  return { line: Math.max(1, Math.min(lineCount, relative)), column }
}
