# Phần mềm bên thứ ba

Mỗi mục ghi nguồn, giấy phép, commit được dùng và phần nào của NexGraph dùng nó. Cập nhật trong cùng PR với việc chép hoặc port mã.

## Graphify

- Nguồn: https://github.com/Graphify-Labs/graphify
- Commit: `86c57be8204673c2a1b9849a3292a7dd3ab373d8` (v0.9.92, 2026-10-16)
- Giấy phép: Apache-2.0; phần đóng góp trước 2026-07-22 còn khả dụng theo MIT. Bản đầy đủ ở `engine/third_party/graphify/`.
- Dùng ở: `engine/src/graphify/` (chép nguyên, ghim commit, không đồng bộ upstream). File nào sửa có dòng đầu `# Modified by NexGraph contributors, 2026`.

## code-review-graph

- Nguồn: https://github.com/tirth8205/code-review-graph
- Commit: `29d8bd94312a02dc85b2f4e3e6c97ebe7e768fb8` (2026-11-10)
- Giấy phép: MIT, Copyright (c) 2026 Tirth Kanani. Bản đầy đủ ở `engine/third_party/code-review-graph/LICENSE`.
- Dùng ở:
  - `engine/src/nexgraph_engine/mcp/server.py` — chép và rút gọn `_run_off_loop`, `_offload` (chạy tool ngoài vòng sự kiện, giới hạn thời gian) và cách viết hướng dẫn server định tuyến theo loại câu hỏi, từ `code_review_graph/main.py`. Đã sửa cho NexGraph.
  - `engine/src/nexgraph_engine/flows/build.py` — port thuật toán dựng BFS và chấm điểm criticality luồng từ `code_review_graph/flows.py`. Đã sửa cho NexGraph (bỏ external calls, áp dụng lược đồ SQLite v5).

## CodeRAG

- Nguồn: https://github.com/galacticsurfer/coderag
- Commit: `a3b13ceac38dfd0f420e0dd9e94447675e1a4a69`
- Giấy phép: Apache-2.0. Bản đầy đủ và NOTICE ở `engine/third_party/coderag/`.
- Dùng ở: `engine/src/nexgraph_engine/query/context.py` — port ý tưởng hợp nhất xếp hạng Reciprocal Rank Fusion (`retrieval/fusion.py`) và dựng ngữ cảnh theo ngân sách token (`context/builder.py`). Viết lại cho NexGraph, không chép nguyên mã.

## Monaco Editor

- Nguồn: https://github.com/microsoft/monaco-editor
- Phiên bản: `0.57.0` (gói npm `monaco-editor`, dùng qua API công khai, không chép mã)
- Giấy phép: MIT, Copyright (c) Microsoft Corporation.
- Dùng ở: `apps/desktop/src/renderer/src/components/editor/monaco.ts` — trình soạn thảo mã trong thẻ tệp của renderer, được Vite gói vào bản dựng.

```text
The MIT License (MIT)

Copyright (c) 2016 - present Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## pi coding-agent

- Nguồn: https://github.com/earendil-works/pi
- Phiên bản: `1.5.2` (gói npm `@earendil-works/pi-coding-agent`, dùng qua API công khai, không chép mã)
- Giấy phép: MIT, Copyright (c) 2025 Mario Zechner. Áp dụng cả các gói pi 1.5.2 đi kèm: `pi-agent-core`, `pi-ai`, `pi-codemode`, `pi-mcp`, `pi-tui` (cùng scope `@earendil-works`).
- Dùng ở: `apps/desktop/src/main/agent/` — harness agent lập trình chạy trong tiến trình main; NexGraph đăng ký tool đồ thị và cổng duyệt qua extension.

```text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## TypeBox

- Nguồn: https://github.com/sinclairzx81/typebox
- Phiên bản: `1.3.27` (gói npm `typebox`, dùng qua API công khai, không chép mã)
- Giấy phép: MIT, Copyright (c) 2017-2026 Haydn Paterson.
- Dùng ở: `apps/desktop/src/main/agent/extension.ts` — bọc JSON Schema của tool đồ thị thành tham số tool của pi.


## react-markdown

- Nguồn: https://github.com/remarkjs/react-markdown
- Phiên bản: 10.1.0; MIT, Espen Hovlandsdal.
- Dùng ở: renderer chat — hiển thị Markdown với trích dẫn được xác minh.

The MIT License (MIT)

Copyright (c) Espen Hovlandsdal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## remark-gfm

- Nguồn: https://github.com/remarkjs/remark-gfm
- Phiên bản: 4.0.1; MIT, Titus Wormer.
- Dùng ở: renderer chat — bảng, danh sách và cú pháp GFM.

(The MIT License)

Copyright (c) Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
