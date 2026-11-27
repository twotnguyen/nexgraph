# Phần mềm bên thứ ba

Mỗi mục ghi nguồn, giấy phép, commit được dùng và phần nào của NexGraph dùng nó. Cập nhật trong cùng PR với việc chép hoặc port mã.

## Antigravity CLI

- Nguồn: https://antigravity.google/download và manifest tải xuống chính thức của Google.
- Phiên bản: `1.5.11`, binary chính thức không sửa đổi, tải theo yêu cầu khi thiết lập tài khoản Google. URL và SHA-512 từng nền tảng được ghim trong `apps/desktop/src/main/features/agent/gemini/installation.ts`.
- Đây là phần mềm riêng của Google; giấy phép Apache-2.0 của NexGraph không áp dụng cho binary CLI. NexGraph không chép mã CLI vào nguồn ứng dụng.
- Dùng ở: `apps/desktop/src/main/features/agent/gemini/` khởi chạy `agy acp` theo [giao diện tích hợp được Google hỗ trợ](https://antigravity.google/docs/ide/extensions/acp/), kết nối công cụ NexGraph bằng MCP HTTP có xác thực. OAuth và vòng suy luận do CLI chính thức thực hiện.

## Graphify

- Nguồn: https://github.com/Graphify-Labs/graphify
- Commit: `16127eb30892f997d758efdd894e5e04264edbbb` (v0.9.120, 2026-11-25; trước 2026-11-26 là `c60eea0`, v0.9.112; trước 2026-11-20 là `86c57be`, v0.9.92)
- Giấy phép: Apache-2.0; phần đóng góp trước 2026-07-22 còn khả dụng theo MIT. Bản đầy đủ ở `engine/third_party/graphify/` (`LICENSE`, `NOTICE`, `LICENSE-MIT`).
- Dùng ở: `engine/src/graphify/` (chép nguyên, ghim commit, đóng băng ở v0.9.120, chỉ backport bản vá bảo mật).
- **Tệp đã sửa đổi so với bản gốc (Apache-2.0 §4(b)):** các tệp trong `engine/src/graphify/` đã được sửa đổi so với bản gốc. Hiện có `extract.py` — chuyển dòng "AST cache:" sang stderr để không làm hỏng JSON của `refresh` và kênh MCP stdio (commit `e484705`); tệp giữ dòng đầu `# Modified by NexGraph contributors, 2026`. Tệp nào sửa tiếp phải thêm dòng tương tự.

Tệp `NOTICE` nguyên văn (`engine/third_party/graphify/NOTICE`):

```text
Graphify
Copyright 2026 Safi Shamsi and the Graphify contributors.

This product is licensed under the Apache License, Version 2.0 (see LICENSE).

Portions of this software were contributed under the MIT License prior to the
relicensing and remain available under those terms. The original MIT license
text is retained in LICENSE-MIT.
```

Giấy phép Apache-2.0 nguyên văn (`engine/third_party/graphify/LICENSE`):

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

Phần MIT cũ nguyên văn (`engine/third_party/graphify/LICENSE-MIT`):

```text
MIT License

Copyright (c) 2026 Safi Shamsi

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

## OpenCode

- Nguồn: https://github.com/sst/opencode
- Phiên bản: `2.4.1` (binary chạy thành tiến trình con, không sửa mã).
- Giấy phép: MIT, Copyright (c) 2025 opencode. Bản đầy đủ nguyên văn từ `LICENSE` của gói `opencode` 2.4.1.
- Dùng ở: runtime agent Nex — `apps/desktop/src/main/features/agent/nex/` khởi chạy `opencode serve` cục bộ với `HOME`/`XDG_*`/`OPENCODE_CONFIG_DIR` riêng; binary đóng gói ở N3-P1.

```text
MIT License

Copyright (c) 2025 opencode

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

## code-review-graph

- Nguồn: https://github.com/tirth8205/code-review-graph
- Commit: `29d8bd94312a02dc85b2f4e3e6c97ebe7e768fb8` (2026-11-10)
- Giấy phép: MIT, Copyright (c) 2026 Tirth Kanani. Bản đầy đủ ở `engine/third_party/code-review-graph/LICENSE`.
- Dùng ở:
  - `engine/src/nexgraph_engine/interfaces/mcp/server.py` — chép và rút gọn `_run_off_loop`, `_offload` (chạy tool ngoài vòng sự kiện, giới hạn thời gian) và cách viết hướng dẫn server định tuyến theo loại câu hỏi, từ `code_review_graph/main.py`. Đã sửa cho NexGraph.
  - `engine/src/nexgraph_engine/analysis/flows/build.py` — port thuật toán dựng BFS và chấm điểm criticality luồng từ `code_review_graph/flows.py`. Đã sửa cho NexGraph (bỏ external calls, áp dụng lược đồ SQLite v5).

## CodeRAG

- Nguồn: https://github.com/galacticsurfer/coderag
- Commit: `a3b13ceac38dfd0f420e0dd9e94447675e1a4a69`
- Giấy phép: Apache-2.0. Bản đầy đủ và NOTICE ở `engine/third_party/coderag/`.
- Dùng ở: `engine/src/nexgraph_engine/analysis/query/context.py` — port ý tưởng hợp nhất xếp hạng Reciprocal Rank Fusion (`retrieval/fusion.py`) và dựng ngữ cảnh theo ngân sách token (`context/builder.py`). Viết lại cho NexGraph, không chép nguyên mã.

## Monaco Editor

- Nguồn: https://github.com/microsoft/monaco-editor
- Phiên bản: `0.57.0` (gói npm `monaco-editor`, dùng qua API công khai, không chép mã)
- Giấy phép: MIT, Copyright (c) Microsoft Corporation.
- Dùng ở: `apps/desktop/src/renderer/src/features/editor/monaco.ts` — trình soạn thảo mã trong thẻ tệp của renderer, được Vite gói vào bản dựng.

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

## Bảng màu theme Wu, One, Catppuccin

- Nguồn: thư mục `assets/themes/` của Wu (https://github.com/dstrml/wu), commit `288f144420fc9f22016b6d65dacbd2a3d77842b3`. Mã chính của Wu là GPL-3.0, nhưng ba tệp theme có giấy phép MIT riêng; NexGraph chỉ chép giá trị màu, không chép mã.
- Giấy phép: MIT. Copyright (c) 2026 Wing (Wu Dark, Wu Light); Copyright (c) 2014 GitHub Inc. (One Dark, One Light); Copyright (c) 2021 Catppuccin (Latte, Frappé, Macchiato, Mocha).
- Dùng ở: `apps/desktop/src/renderer/src/styles.css` (khối `:root[data-theme='…']`), danh sách theme trong `apps/desktop/src/renderer/src/shared/lib/useTheme.ts`.

```text
MIT License

Copyright (c) 2026 Wing
Copyright (c) 2014 GitHub Inc.
Copyright (c) 2021 Catppuccin

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

## Bộ icon tệp Symbols

- Nguồn: thư mục `assets/icon_themes/symbols/` của Wu (https://github.com/dstrml/wu), commit `288f144420fc9f22016b6d65dacbd2a3d77842b3`; gốc là bộ Symbols của Miguel Solorio.
- Giấy phép: MIT, Copyright (c) 2020-22 Miguel Solorio. Bản đầy đủ ở `apps/desktop/src/renderer/src/assets/file-icons/LICENSE`.
- Dùng ở: `apps/desktop/src/renderer/src/assets/file-icons/` (66 SVG chép nguyên, biến thể tối có hậu tố `.dark.svg`) và bảng tra đuôi tệp → icon trong `apps/desktop/src/renderer/src/shared/ui/FileTypeIcon.tsx` (phần con của `icon_theme.json`).

## pi coding-agent

- Nguồn: https://github.com/earendil-works/pi
- Phiên bản: `1.5.2` (gói npm `@earendil-works/pi-coding-agent`, dùng qua API công khai, không chép mã)
- Giấy phép: MIT, Copyright (c) 2025 Mario Zechner. Áp dụng cả các gói pi 1.5.2 đi kèm: `pi-agent-core`, `pi-ai`, `pi-codemode`, `pi-mcp`, `pi-tui` (cùng scope `@earendil-works`).
- Dùng ở: `apps/desktop/src/main/features/agent/` — harness agent lập trình chạy trong tiến trình main; NexGraph đăng ký tool đồ thị và cổng duyệt qua extension.

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
- Dùng ở: `apps/desktop/src/main/features/agent/extension.ts` — bọc JSON Schema của tool đồ thị thành tham số tool của pi.

## monaco-vim

- Nguồn: https://github.com/brijeshb42/monaco-vim
- Phiên bản: `0.4.4` (gói npm, dùng qua API công khai `initVimMode`, không chép mã)
- Giấy phép: MIT, Copyright (c) 2018 Brijesh Bittu; phần keymap Vim lấy từ CodeMirror (MIT). Bản đầy đủ trong gói (`LICENSE`, `LICENSE.codemirror.txt`).
- Dùng ở: `apps/desktop/src/renderer/src/features/editor/monaco.ts` — chế độ Vim của editor.

## typescript-language-server và TypeScript

- Nguồn: https://github.com/typescript-language-server/typescript-language-server, https://github.com/microsoft/TypeScript
- Phiên bản: `6.1.0` và `5.9.3` (chạy thành tiến trình con, không sửa mã)
- Giấy phép: Apache-2.0 (typescript-language-server: Copyright (c) TypeFox và các tác giả; TypeScript: Copyright (c) Microsoft Corporation).
- Dùng ở: `apps/desktop/src/main/features/lsp/manager.ts` — định nghĩa, gợi ý, hover cho tệp TS/JS trong editor.

## Pyright

- Nguồn: https://github.com/microsoft/pyright
- Phiên bản: `1.1.414` (chạy `pyright-langserver` thành tiến trình con, không sửa mã)
- Giấy phép: MIT, Copyright (c) Microsoft Corporation.
- Dùng ở: `apps/desktop/src/main/features/lsp/manager.ts` — định nghĩa, gợi ý, hover cho tệp Python trong editor.

## xterm.js

- Nguồn: https://github.com/xtermjs/xterm.js
- Phiên bản: `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0, `@xterm/addon-search` 0.16.0, `@xterm/addon-web-links` 0.12.0 (dùng qua API công khai, không chép mã)
- Giấy phép: MIT, Copyright (c) 2017-2019 The xterm.js authors; Copyright (c) 2014-2016 SourceLair Private Company; Copyright (c) 2012-2013 Christopher Jeffrey.
- Dùng ở: `apps/desktop/src/renderer/src/features/terminal/TerminalPanel.tsx` — terminal tích hợp.

## node-pty

- Nguồn: https://github.com/microsoft/node-pty
- Phiên bản: `1.2.0-beta.18` (dùng qua API công khai, không chép mã; bản dựng N-API có sẵn trong gói)
- Giấy phép: MIT, Copyright (c) 2012-2015 Christopher Jeffrey, Copyright (c) 2016 Daniel Imms, Copyright (c) Microsoft Corporation.
- Dùng ở: `apps/desktop/src/main/features/terminal/manager.ts` — chạy shell cho terminal tích hợp.

## js-debug và debugpy (tải khi người dùng bấm "Tải về" trong bảng Gỡ lỗi, không đóng gói sẵn)

- js-debug: https://github.com/microsoft/vscode-js-debug, bản `js-debug-dap-v1.140.1` (MIT, Copyright (c) Microsoft Corporation). Chạy `dapDebugServer.js` bằng Node của Electron làm debug adapter cho Node.js.
- debugpy: https://github.com/microsoft/debugpy, bản `1.8.22` (wheel `py2.py3-none-any`, MIT, Copyright (c) Microsoft Corporation). Chạy `python -m debugpy.adapter` bằng Python của người dùng.
- Cả hai tải từ địa chỉ cố định, kiểm SHA-256 rồi giải nén vào thư mục dữ liệu của app (`debug-adapters/`); giấy phép đi kèm trong thư mục giải nén. Dùng ở `apps/desktop/src/main/features/debug/`.

## Yjs, y-monaco, y-protocols, ws

- Nguồn: https://github.com/yjs/yjs, https://github.com/yjs/y-monaco, https://github.com/yjs/y-protocols, https://github.com/websockets/ws
- Phiên bản: yjs `13.6.33`, y-monaco `0.1.6`, y-protocols `1.0.7`, ws `8.23.0` (dùng qua API công khai, không chép mã)
- Giấy phép: MIT (Yjs, y-monaco, y-protocols: Copyright (c) Kevin Jahns; ws: Copyright (c) Einar Otto Stangvik và các tác giả).
- Dùng ở: `apps/desktop/src/renderer/src/features/collab/collab.ts` (CRDT và con trỏ), `apps/desktop/src/main/features/collab/hub.ts` (WebSocket trong LAN).


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


## electron-updater

- Nguồn: https://github.com/electron-userland/electron-builder (gói `electron-updater`)
- Phiên bản: 6.8.11; MIT, Loopline Systems.
- Dùng ở: main process — kiểm tra và cài bản cập nhật từ GitHub Releases trên Windows (`src/main/app/update/`). Kéo theo các thư viện MIT của chính gói (builder-util-runtime, fs-extra, js-yaml, lazy-val, lodash.escaperegexp, lodash.isequal, tiny-typed-emitter).

The MIT License (MIT)

Copyright (c) 2015 Loopline Systems

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

## semver

- Nguồn: https://github.com/npm/node-semver
- Phiên bản: 7.8.5; ISC, Isaac Z. Schlueter và cộng sự.
- Dùng ở: main process — so phiên bản khi kiểm tra cập nhật.

The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## vis-network

- Nguồn: https://github.com/visjs/vis-network
- Phiên bản: `9.1.6` — tệp `vis-network-9.1.6.min.js` giữ nguyên byte so với bản phát hành (trang HTML có SRI, sửa tệp là script không chạy).
- Giấy phép: kép Apache-2.0 hoặc MIT (`"license": "(Apache-2.0 OR MIT)"` trong `package.json`); NexGraph dùng theo MIT. Giấy phép Apache-2.0 cùng nội dung chuẩn ở mục Graphify; bản gốc của gói là `LICENSE-APACHE-2.0`.
- Dùng ở: `apps/desktop/resources/graph-pages/vis-network-9.1.6.min.js` — trang đồ thị `.nexgraph/` nhúng offline (N1-D1).

Thông báo giấy phép kép nguyên văn trong bundle:

```text
/**
 * vis-network
 * https://visjs.github.io/vis-network/
 *
 * A dynamic, browser-based visualization library.
 *
 * @version 9.1.6
 * @date    2023-03-23T21:31:19.223Z
 *
 * @copyright (c) 2011-2017 Almende B.V, http://almende.com
 * @copyright (c) 2017-2019 visjs contributors, https://github.com/visjs
 *
 * @license
 * vis.js is dual licensed under both
 *
 *   1. The Apache 2.0 License
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *   and
 *
 *   2. The MIT License
 *      http://opensource.org/licenses/MIT
 *
 * vis.js may be distributed under either license.
 */
```

Giấy phép MIT nguyên văn (`LICENSE-MIT` của gói 9.1.6):

```text
The MIT License (MIT)

Copyright (c) 2014-2017 Almende B.V.

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

## d3

- Nguồn: https://github.com/d3/d3
- Phiên bản: `7.9.2` (tệp `d3.v7.min.js`).
- Giấy phép: ISC. Nguyên văn:

```text
Copyright 2010-2026 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

- Dùng ở: `apps/desktop/resources/graph-pages/d3.v7.min.js` — trang cây `GRAPH_TREE.html` của đồ thị (N1-D1).

## Mermaid

- Nguồn: https://github.com/mermaid-js/mermaid
- Phiên bản: 12.3.0 (gói npm `mermaid`, dùng qua API công khai, không chép mã) cho xem trước Markdown trong editor; 11.17.2 (`mermaid-11.min.js`, tải từ `cdn.jsdelivr.net/npm/mermaid@11`) cho các sơ đồ trong trang Luồng gọi của đồ thị. Cả hai dùng MIT, Knut Sveidqvist.
- Phụ thuộc kéo theo của bản 12.3.0: 122 gói, phần lớn MIT hoặc ISC; còn lại BSD-3-Clause, Apache-2.0 (Chevrotain), Unlicense (robust-predicates), DOMPurify (MPL-2.0 hoặc Apache-2.0, dùng theo Apache-2.0) và elkjs (EPL-2.0 hoặc GPL-3.0-or-later, dùng theo EPL-2.0). Mỗi gói giữ giấy phép riêng trong gói npm của nó.
- Dùng ở: `apps/desktop/src/renderer/src/features/viewers/MermaidBlock.tsx` — vẽ khối ```mermaid trong xem trước Markdown thành SVG (`securityLevel: 'strict'`). Vite gói thành các chunk chỉ nạp khi gặp khối đầu tiên. Bản 11.17.2 nằm ở `apps/desktop/resources/graph-pages/mermaid-11.min.js` cho `pi-callflow.html` (N1-D1).

The MIT License (MIT)

Copyright (c) 2014 - 2022 Knut Sveidqvist

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
