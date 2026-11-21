import { describe, expect, it } from 'vitest'
import { completionToken, filterSlashCommands, imageError, removeQueued, replaceQueued, takeQueued } from './composer'

describe('gợi ý trong ô soạn tin', () => {
  it('nhận diện lệnh và mention tại vị trí con trỏ, không nhầm đường dẫn hay email', () => {
    expect(completionToken('/mo', 3)).toEqual({ kind: 'command', start: 0, end: 3, query: 'mo' })
    expect(completionToken('xem @dbg_demo.py ngay', 8)).toEqual({ kind: 'mention', start: 4, end: 16, query: 'dbg' })
    expect(completionToken('mail@example.com', 16)).toBeNull()
    expect(completionToken('/usr/bin', 2)).toBeNull()
    expect(completionToken('trước (/@', 9)).toBeNull()
  })

  it('ưu tiên lệnh bắt đầu bằng truy vấn rồi đến lệnh có chứa truy vấn', () => {
    const commands = [{ name: 'resume' }, { name: 'model' }, { name: 'new' }]
    expect(filterSlashCommands(commands, 'mo').map((item) => item.name)).toEqual(['model'])
    expect(filterSlashCommands(commands, 'e').map((item) => item.name)).toEqual(['resume', 'model', 'new'])
  })
})

describe('hàng đợi', () => {
  const queue = [{ id: 1, text: 'một' }, { id: 2, text: 'hai' }, { id: 3, text: 'ba' }]
  it('lấy theo thứ tự, bỏ qua tin đang sửa mà không mất tin đó', () => {
    expect(takeQueued(queue, 1)).toEqual({ item: queue[1], queue: [queue[0], queue[2]] })
    expect(takeQueued([queue[0]], 1)).toBeNull()
  })
  it('sửa và gỡ đúng tin, giữ thứ tự các tin còn lại', () => {
    expect(replaceQueued(queue, 2, { id: 2, text: 'đã sửa' }).map((item) => item.text)).toEqual(['một', 'đã sửa', 'ba'])
    expect(removeQueued(queue, 2).map((item) => item.id)).toEqual([1, 3])
  })
})

describe('ảnh đính kèm', () => {
  it('chỉ chấp nhận png, jpeg, gif, webp không quá 24 MB', () => {
    expect(imageError({ name: 'a.png', type: 'image/png', size: 24 * 1024 * 1024 })).toBeNull()
    expect(imageError({ name: 'a.webp', type: 'image/webp', size: 1 })).toBeNull()
    expect(imageError({ name: 'a.svg', type: 'image/svg+xml', size: 1 })).toContain('PNG')
    expect(imageError({ name: 'a.jpg', type: 'image/jpeg', size: 24 * 1024 * 1024 + 1 })).toContain('24 MB')
    expect(imageError({ name: 'rỗng.gif', type: 'image/gif', size: 0 })).toContain('rỗng')
  })
})
