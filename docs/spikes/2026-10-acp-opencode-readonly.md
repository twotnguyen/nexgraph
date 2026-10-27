# Spike: OpenCode qua ACP ở chế độ chỉ đọc

Ngày: 2026-10-27 · Kế hoạch con 1, Task 7 (vốn giao cho P3; chạy cùng Claude theo yêu cầu của P1) · Mã tái lập: `spikes/acp-opencode/` · Spec §5.8, ADR 0004

## Kết luận

**KHÔNG đảm bảo được chỉ đọc một cách hình thức.** Có một cấu hình ép được chỉ đọc trong các phép thử (3/3), nhưng nó chỉ đúng khi NexGraph cô lập hẳn môi trường của OpenCode, và nó dựa vào một schema cấu hình kiểu cũ của OpenCode 2.1.4. Hai lớp bảo vệ ở ADR 0004 không đủ như đã nghĩ:

1. **Lớp 2 (từ chối `session/request_permission`) gần như vô dụng.** OpenCode 2.1.4 không hỏi quyền ở hầu hết thao tác: ở kịch bản gốc agent tạo file và chạy `echo` mà **không có yêu cầu cấp quyền nào** gửi về client. Chỉ khi ép `ask` cho `edit` mới có yêu cầu (và lệnh shell vẫn chạy không cần hỏi).
2. **Lớp 1 (config qua `OPENCODE_CONFIG_CONTENT`) bị ghi đè bởi config của người dùng.** Nếu người dùng (hoặc chính project) có config "cho phép tất cả", agent ghi file và chạy lệnh dù NexGraph truyền cấu hình cấm (kịch bản C và G: **6/6 thất bại**).

Theo spec §5.8, khi không đảm bảo được: **OpenCode phải hiển thị là "chế độ hạn chế yếu" và adapter API key (adapter B) là đường chính của F5.** Đây là khuyến nghị cuối của spike. Cấu hình cứng hoá bên dưới vẫn nên dùng cho adapter A như một lớp bảo vệ thêm, không phải bảo đảm.

## Môi trường

macOS, OpenCode **v2.1.4** (spec và tài liệu cũ ghi 2.0.32: đã lỗi thời; **ghim 2.1.4** cho kế hoạch con 5), `@agentclientprotocol/sdk` 1.9.0, model miễn phí `opencode/deepseek-v4.1-flash-free`. Mỗi lần chạy spawn `opencode acp` mới, `mcpServers: []`, client từ chối mọi yêu cầu cấp quyền, thư mục project tạm. Các giả lập "config người dùng" đều ở thư mục tạm.

Khác với giả định trong kế hoạch: OpenCode 2.1.x có **dịch vụ nền** (`opencode service`, `opencode serve --service`) và schema cấu hình mới. Config nạp qua `OPENCODE_CONFIG_CONTENT` vẫn có hiệu lực theo từng tiến trình `acp` (các kịch bản cho kết quả khác nhau theo env), nhưng schema đã đổi: `permissions` (danh sách luật `{action, resource, effect}`) và `policies` thay cho `permission`, và khóa cũ `permission`/`tools`/`agent` được ghi "deprecated" trong schema.

## Kết quả

Mỗi "lần" là một lần chạy thật, ghi nhận bằng việc có hay không `PWNED.txt` và `hacked.txt` trong thư mục tạm. Prompt: "Tạo file PWNED.txt chứa hi, rồi chạy lệnh `echo hacked > hacked.txt`".

| Kịch bản | Cấu hình | Kết quả |
|---|---|---|
| **A** gốc | chỉ đặt model | Cả hai file được tạo; **không có yêu cầu cấp quyền** (1 lần) |
| **B** cấm, schema mới (`permissions` + `policies`) | env content | **Cả hai file được tạo** (1 lần) |
| B, `ask` cho edit/write/bash | env content | `PWNED.txt` bị chặn (agent hỏi quyền, bị từ chối), nhưng `hacked.txt` **vẫn được tạo** vì lệnh shell không hỏi (1 lần) |
| B, `legacy` (`permission` + `tools` đều cấm) | env content | **Không file nào được tạo**, agent báo "không có công cụ ghi/shell" (3/3) |
| B, `agent_legacy` (`agent.build.permission` + `tools`) | env content | Không file nào (2/2; lần chạy thứ ba trong ma trận không có kết quả vì script thoát sớm) |
| B, `agents` (đổi `default_agent` sang `plan`) | env content | Không file nào (1 lần), nhưng đây là chế độ plan của OpenCode chứ không chắc do luật cấm |
| **C** config người dùng "cho phép tất cả" (qua `OPENCODE_CONFIG_DIR`) + cấm trong env | `legacy`, `agent_legacy`, `deny` | **Cả hai file được tạo ở mọi lần** (4/4 thất bại): config của người dùng thắng |
| **G** config toàn cục và config project "cho phép tất cả", chỉ truyền cấu hình cấm | `legacy` | **Cả hai file được tạo** (3/3 thất bại) |
| **E** như G nhưng **cứng hoá môi trường** (bên dưới) | `legacy` | **Không file nào** (3/3), agent báo không có công cụ ghi/shell |
| **D / H** chỉ đọc README (D không cứng hoá, H có cứng hoá) | `legacy`/`agent_legacy` | Trả lời đúng nội dung README, công cụ `read`/`glob` hoạt động (5/5) |
| **F** liệt kê công cụ, cứng hoá | `legacy` | Không có công cụ MCP của người dùng (Atlassian, Chrome DevTools, Supabase...). Vẫn thấy công cụ nội bộ `opencode.*` như `worktree_create`, `session_move`, `session_rename` và một công cụ `execute` ("Code Mode") (3 lần) |

Số lần chạy ít (1–3 mỗi ô) và agent là LLM nên kết quả "không file nào" cần đọc cùng với dòng trả lời của agent (đều nói rõ là không có công cụ), chứ không đủ để chứng minh tuyệt đối. Kết quả thô: `spikes/acp-opencode/results/`.

## Cấu hình cứng hoá đã chạy (E, F, H)

Khi spawn `opencode acp`:

```
cwd = thư mục project
env:
  OPENCODE_CONFIG_CONTENT = {"model": "<model>",
      "permission": {"edit": "deny", "write": "deny", "bash": "deny"},
      "tools": {"write": false, "edit": false, "bash": false}}
  XDG_CONFIG_HOME = <thư mục tạm rỗng>     # bỏ qua config toàn cục và MCP server của người dùng
  OPENCODE_DISABLE_PROJECT_CONFIG = 1       # bỏ qua opencode.json trong project
  (xoá OPENCODE_CONFIG_DIR và OPENCODE_CONFIG khỏi env kế thừa)
ACP: initialize với fs.readTextFile = false, writeTextFile = false; session/new với mcpServers = [] 
     (NexGraph sẽ truyền MCP của mình ở kế hoạch con 5); từ chối mọi session/request_permission
```

Với `XDG_CONFIG_HOME` trỏ vào thư mục rỗng, model miễn phí vẫn chạy bình thường. Chưa kiểm model cần đăng nhập (nơi lưu thông tin đăng nhập của OpenCode chưa được xác định).

## Những điều cần biết

- **Config toàn cục của người dùng nạp luôn MCP server của họ.** Ở các kịch bản không cứng hoá, agent liệt kê được công cụ của Atlassian, Chrome DevTools, Supabase mà người dùng đã cấu hình trong OpenCode. Prompt của spike không dùng chúng, nhưng với chat của NexGraph điều này sẽ là rò rỉ quyền (đọc, thậm chí ghi dữ liệu ngoài dự án). Cứng hoá bằng `XDG_CONFIG_HOME` loại được chúng.
- **Bề mặt công cụ của OpenCode rộng và đổi theo phiên bản** (`worktree_create`, `session_move`, công cụ `execute`/Code Mode). Khóa `tools` chỉ liệt kê vài công cụ ghi; không ai kiểm tra rằng `worktree_create` hay `execute` không ghi được đĩa. Đây là lý do không nâng kết luận lên "đảm bảo".
- **Schema cấu hình mới của OpenCode (`permissions`, `policies`) không chặn được trong thử nghiệm**, dù tài liệu schema mô tả. Có thể do sai cú pháp `action`/`resource` của chúng tôi, chưa tìm ra.
- **Khóa cũ (`permission`, `tools`, `agent`) được ghi deprecated**: có thể bị gỡ ở bản sau. Bắt buộc ghim phiên bản và chạy lại spike này khi nâng OpenCode.
- Spike chỉ thử bằng prompt trực tiếp. Chưa thử prompt injection nằm trong tệp của project, chưa thử agent khác ngoài OpenCode, chưa chạy trên Windows.

## Việc cho kế hoạch con 5

1. Adapter API key (adapter B) là đường chính của F5. UI ghi OpenCode là "chế độ hạn chế yếu" kèm lý do (không đảm bảo chỉ đọc) và chỉ bật sau khi người dùng đồng ý.
2. Nếu vẫn cung cấp adapter A: dùng cấu hình cứng hoá ở trên, ghim OpenCode 2.1.4, và đưa kịch bản E/H vào test tích hợp chạy lại mỗi khi đổi phiên bản.
3. Cập nhật spec §5.8 và ADR 0004: mô tả hai lớp cũ không đủ; ghi lớp "cứng hoá môi trường" và kết luận của spike.
