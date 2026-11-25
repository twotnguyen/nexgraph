import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * LIC-1: `THIRD_PARTY_LICENSES.md` là nơi duy nhất trong bộ cài nêu tên dự án nguồn,
 * nên nội dung pháp lý phải đủ và nguyên văn: NOTICE + Apache-2.0 + MIT của Graphify,
 * MIT của OpenCode, giấy phép kép của vis-network, ISC của d3, MIT của mermaid 11.17.2.
 * Test đọc thẳng tệp ở gốc repo (đường dẫn tương đối theo test, không theo cwd).
 */
const root = fileURLToPath(new URL('../../..', import.meta.url))
const read = (name: string): string => readFileSync(join(root, name), 'utf8')

/**
 * Xuống dòng về LF. Checkout Windows (`core.autocrlf`) đổi `\n` thành `\r\n` trong tệp .md nên marker
 * `\n## X\n` và các chuỗi nhiều dòng không khớp (CI Windows của PR #74 đỏ vì vậy).
 */
const toLf = (text: string): string => text.replace(/\r\n/g, '\n')

/** Nội dung một mục `## <heading>` tới mục kế tiếp (đã chuẩn hoá LF, nên so được trên mọi hệ điều hành). */
function section(source: string, heading: string): string {
  const text = toLf(source)
  const marker = `\n## ${heading}\n`
  const start = text.indexOf(marker)
  expect(start, `thiếu mục ## ${heading}`).toBeGreaterThan(-1)
  const rest = text.slice(start + marker.length)
  const end = rest.search(/\n## /)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('THIRD_PARTY_LICENSES.md (LIC-1)', () => {
  const text = read('THIRD_PARTY_LICENSES.md')

  it('giữ các mục cũ (không xoá nghĩa vụ đã ghi)', () => {
    for (const heading of ['Antigravity CLI', 'code-review-graph', 'CodeRAG', 'Monaco Editor', 'pi coding-agent',
      'TypeBox', 'monaco-vim', 'typescript-language-server và TypeScript', 'Pyright', 'xterm.js', 'node-pty',
      'Yjs, y-monaco, y-protocols, ws', 'react-markdown', 'remark-gfm']) {
      expect(text).toContain(`## ${heading}`)
    }
  })

  it('Graphify: NOTICE nguyên văn, Apache-2.0 đầy đủ, MIT cũ từ LICENSE-MIT, ghi chú sửa đổi §4(b)', () => {
    const graphify = section(text, 'Graphify')
    // NOTICE nguyên văn (engine/third_party/graphify/NOTICE).
    expect(graphify).toContain('Graphify\nCopyright 2026 Safi Shamsi and the Graphify contributors.')
    expect(graphify).toContain('This product is licensed under the Apache License, Version 2.0 (see LICENSE).')
    expect(graphify).toContain('Portions of this software were contributed under the MIT License prior to the')
    expect(graphify).toContain('relicensing and remain available under those terms. The original MIT license')
    expect(graphify).toContain('text is retained in LICENSE-MIT.')
    // Giấy phép Apache-2.0 nguyên văn (engine/third_party/graphify/LICENSE).
    expect(graphify).toContain('Apache License\n                           Version 2.0, January 2004')
    expect(graphify).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION')
    expect(graphify).toContain('9. Accepting Warranty or Additional Liability.')
    expect(graphify).toContain('END OF TERMS AND CONDITIONS')
    // Phần MIT cũ (engine/third_party/graphify/LICENSE-MIT).
    expect(graphify).toContain('MIT License\n\nCopyright (c) 2026 Safi Shamsi')
    // Apache-2.0 §4(b): nêu rõ tệp vendor đã sửa so với bản gốc.
    expect(graphify).toMatch(/sửa đổi so với bản gốc/i)
    expect(graphify).toContain('extract.py')
  })

  it('OpenCode: MIT Copyright (c) 2025 opencode, nguyên văn từ LICENSE của bản 2.4.1', () => {
    const opencode = section(text, 'OpenCode')
    expect(opencode).toContain('2.4.1')
    expect(opencode).toContain('MIT License\n\nCopyright (c) 2025 opencode')
    expect(opencode).toContain('Permission is hereby granted, free of charge, to any person obtaining a copy')
    expect(opencode).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND')
  })

  it('vis-network 9.1.6: giấy phép kép Apache-2.0/MIT, nguyên văn thông báo trong bundle', () => {
    const vis = section(text, 'vis-network')
    expect(vis).toContain('9.1.6')
    expect(vis).toContain('Apache-2.0')
    expect(vis).toContain('MIT')
    expect(vis).toContain('vis.js is dual licensed under both')
    expect(vis).toContain('The MIT License (MIT)\n\nCopyright (c) 2014-2017 Almende B.V.')
  })

  it('d3 7.9.2: ISC nguyên văn', () => {
    const d3 = section(text, 'd3')
    expect(d3).toContain('7.9.2')
    expect(d3).toContain('ISC')
    expect(d3).toContain('Copyright 2010-2026 Mike Bostock')
    expect(d3).toContain('Permission to use, copy, modify, and/or distribute this software for any purpose')
  })

  it('mermaid 11.17.2: MIT (bản trang đồ thị) và bản 12.3.0 của editor', () => {
    const mermaid = section(text, 'Mermaid')
    expect(mermaid).toContain('11.17.2')
    expect(mermaid).toContain('Copyright (c) 2014 - 2022 Knut Sveidqvist')
    expect(mermaid).toContain('MIT')
  })

  it('chịu được checkout CRLF (Windows core.autocrlf): mỗi mục có nội dung y như bản LF (B3)', () => {
    const lf = text.replace(/\r\n/g, '\n')
    const crlf = lf.replace(/\n/g, '\r\n')
    expect(crlf).toContain('\r\n')
    for (const heading of ['Graphify', 'OpenCode', 'vis-network', 'd3', 'Mermaid']) {
      expect(section(crlf, heading), heading).toBe(section(lf, heading))
      expect(section(crlf, heading), heading).not.toContain('\r')
    }
  })
})
