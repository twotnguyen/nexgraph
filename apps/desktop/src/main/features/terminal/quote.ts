import { basename } from 'node:path'

export type Quote = (value: string) => string

/**
 * Quote một giá trị để shell của nền tảng nhận nguyên văn: dùng cho `args` của task (shellTask) và cho
 * biến `${file}`… chèn vào `command`. Trên POSIX dùng nháy đơn, trên Windows PowerShell nháy đơn ('' escape)
 * hoặc cmd nháy kép ("" escape) tuỳ shell mặc định.
 */
export function shellQuote(shellFile: string, platform: NodeJS.Platform = process.platform): Quote {
  if (platform !== 'win32') return (value) => `'${value.replace(/'/g, `'"'"'`)}'`
  const cmd = /^cmd(?:\.exe)?$/i.test(basename(shellFile))
  return cmd
    ? (value) => `"${value.replace(/"/g, '""')}"`
    : (value) => `'${value.replace(/'/g, "''")}'`
}
