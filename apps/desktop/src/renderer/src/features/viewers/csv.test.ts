import { describe, expect, it } from 'vitest'
import { delimiterFor, parseDelimited } from './csv'

describe('parseDelimited', () => {
  it('tách ô và ghi dòng nguồn của từng bản ghi', () => {
    const table = parseDelimited('id,tên,điểm\n1,An,9\n2,Bình,8', ',')
    expect(table.rows).toEqual([['id', 'tên', 'điểm'], ['1', 'An', '9'], ['2', 'Bình', '8']])
    expect(table.lines).toEqual([1, 2, 3])
    expect(table.columns).toBe(3)
    expect(table.truncated).toBe(false)
  })

  it('ô trong ngoặc kép giữ dấu phẩy và ngoặc kép lặp đôi thành một', () => {
    const table = parseDelimited('họ tên,ghi chú\n"Nguyễn, Văn A","nói ""xin chào"""\n"",x', ',')
    expect(table.rows[1]).toEqual(['Nguyễn, Văn A', 'nói "xin chào"'])
    expect(table.rows[2]).toEqual(['', 'x'])
  })

  it('ô có xuống dòng là một bản ghi trải nhiều dòng; dòng nguồn của bản ghi sau vẫn đúng', () => {
    const table = parseDelimited('a,b\n"một\nhai\nba",x\ntiếp,y\n', ',')
    expect(table.rows).toEqual([['a', 'b'], ['một\nhai\nba', 'x'], ['tiếp', 'y']])
    expect(table.lines).toEqual([1, 2, 5])
  })

  it('chấp nhận CRLF và CR đơn, nhưng giữ nguyên CRLF trong ô trích dẫn', () => {
    const crlf = parseDelimited('a,b\r\n1,2\r\n3,4\r\n', ',')
    expect(crlf.rows).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
    expect(crlf.lines).toEqual([1, 2, 3]) // \r\n là một lần xuống dòng, không phải hai
    expect(parseDelimited('a\rb\r', ',').rows).toEqual([['a'], ['b']])
    expect(parseDelimited('a,b\r\n"x\r\ny",z\r\nq,r', ',').lines).toEqual([1, 2, 4]) // \r\n trong ô trích dẫn cũng chỉ tính một dòng
    expect(parseDelimited('a,b\r\n"x\r\ny",z', ',').rows[1]).toEqual(['x\r\ny', 'z'])
  })

  it('TSV: dấu tab phân cách, dấu phẩy là chữ thường', () => {
    const table = parseDelimited('a\tb,c\n"d\te"\tf', '\t')
    expect(table.rows).toEqual([['a', 'b,c'], ['d\te', 'f']])
  })

  it('dòng thiếu cột không bị độn; `columns` là bản ghi dài nhất', () => {
    const table = parseDelimited('a,b,c\n1\n1,2,3,4\n,', ',')
    expect(table.rows).toEqual([['a', 'b', 'c'], ['1'], ['1', '2', '3', '4'], ['', '']])
    expect(table.columns).toBe(4)
  })

  it('bỏ dòng trống nhưng giữ bản ghi chỉ có ô rỗng; dòng nguồn không lệch', () => {
    const table = parseDelimited('a,b\n\n   \n,\nx,y\n\n', ',')
    expect(table.rows).toEqual([['a', 'b'], ['', ''], ['x', 'y']])
    expect(table.lines).toEqual([1, 4, 5])
  })

  it('ngoặc kép giữa ô là chữ thường; chữ sau ngoặc đóng nối vào ô', () => {
    expect(parseDelimited('5" ống,"ab"cd,"x"y"z', ',').rows).toEqual([['5" ống', 'abcd', 'xy"z']])
  })

  it('ngoặc kép không đóng nuốt phần còn lại thay vì treo', () => {
    expect(parseDelimited('a,"b\nc,d', ',').rows).toEqual([['a', 'b\nc,d']])
  })

  it('văn bản rỗng không có bản ghi', () => {
    expect(parseDelimited('', ',')).toEqual({ rows: [], columns: 0, lines: [], truncated: false })
    expect(parseDelimited('\n\n', ',').rows).toEqual([])
  })

  it('dừng ở `limit` và chỉ báo cắt khi còn bản ghi thật phía sau', () => {
    const cut = parseDelimited('h\n1\n2\n3\n', ',', 2)
    expect(cut.rows).toEqual([['h'], ['1']])
    expect(cut.truncated).toBe(true)
    // Đúng `limit` bản ghi, phần sau chỉ là dòng trống: không cắt.
    const whole = parseDelimited('h\n1\n\n\n', ',', 2)
    expect(whole.rows).toEqual([['h'], ['1']])
    expect(whole.truncated).toBe(false)
  })
})

describe('delimiterFor', () => {
  it('chọn dấu phân cách theo đuôi, không phân biệt hoa thường', () => {
    expect(delimiterFor('data.csv')).toBe(',')
    expect(delimiterFor('a/b/DATA.TSV')).toBe('\t')
  })

  it('không nhận đuôi giả', () => {
    for (const file of ['data.csv.bak', 'csv', 'thư mục.csv/tệp', 'data.constructor', 'data.csv\n']) expect(delimiterFor(file)).toBeNull()
  })
})
