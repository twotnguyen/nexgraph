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
