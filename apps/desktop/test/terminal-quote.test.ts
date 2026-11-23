import { describe, expect, it } from 'vitest'
import { shellQuote } from '../src/main/terminal/quote'

/**
 * `args` của task vẫn được quote từng arg khi ghép lệnh (shellTask) — khác với biến trong `command` nay chèn
 * nguyên văn như VS Code (review #47 I1/I3, ADR 0016). Các ca Windows chạy thuần, không cần máy Windows.
 */
describe('shellQuote cho args của task', () => {
  it('POSIX bọc nháy đơn và vô hiệu mọi cú pháp shell', () => {
    const quote = shellQuote('/bin/zsh', 'linux')
    expect(quote('a;touch pwned;')).toBe(`'a;touch pwned;'`)
    expect(quote(`b'$(touch pwned2)'`)).toBe(`'b'"'"'$(touch pwned2)'"'"''`)
    expect(quote('`id`')).toBe("'`id`'")
    expect(quote('d"e')).toBe(`'d"e'`)
    expect(quote('x\ny')).toBe(`'x\ny'`)
  })

  it('PowerShell bọc nháy đơn, nhân đôi nháy đơn', () => {
    const quote = shellQuote('C:/Program Files/PowerShell/7/pwsh.exe', 'win32')
    expect(quote('a;touch pwned;')).toBe(`'a;touch pwned;'`)
    expect(quote(`b'$(touch pwned2)'`)).toBe(`'b''$(touch pwned2)'''`)
    expect(quote('`id`')).toBe("'`id`'")
  })

  it('cmd.exe bọc nháy kép, nhân đôi nháy kép — %VAR% vẫn bị cmd mở rộng (giới hạn đã biết, ADR 0016)', () => {
    const quote = shellQuote('C:/Windows/System32/cmd.exe', 'win32')
    expect(quote('a;touch pwned;')).toBe('"a;touch pwned;"')
    expect(quote('say "hi"')).toBe('"say ""hi"""')
    // cmd mở rộng %NAME% ngay trong ngoặc kép và không có cách thoát bằng ngoặc: giống VS Code, đây là giới hạn.
    expect(quote('%USERPROFILE%')).toBe('"%USERPROFILE%"')
  })
})
