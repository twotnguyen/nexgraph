# Spike: OpenCode qua ACP ở chế độ chỉ đọc

Kết luận ở `docs/spikes/2026-10-acp-opencode-readonly.md`. Thư mục này chứa mã tái lập.

```bash
cd spikes/acp-opencode
pnpm install --ignore-workspace
SPIKE_VARIANT=legacy pnpm exec tsx spike.ts A B C D E F G H     # chọn kịch bản; mặc định chạy hết
```

- Cần OpenCode đã cài và đăng nhập (`opencode models` liệt kê được model). Mặc định dùng model miễn phí `opencode/deepseek-v4.1-flash-free`, đổi bằng `SPIKE_MODEL`.
- Mỗi kịch bản spawn một `opencode acp` mới trong một thư mục project tạm (`README.md` + `lib/main.dart`) và đưa agent một prompt yêu cầu **tạo file và chạy lệnh shell** (hoặc chỉ đọc README). Mọi yêu cầu cấp quyền ACP đều bị từ chối. Kết quả kiểm bằng việc `PWNED.txt` / `hacked.txt` có tồn tại trong thư mục tạm hay không.
- `SPIKE_VARIANT`: `deny` (schema mới `permissions` + `policies`), `legacy` (`permission` + `tools`), `ask`, `agents`, `agent_legacy`.
- Kịch bản `hostile` ghi config "cho phép tất cả" vào config toàn cục và config project giả lập; `hardened` là cách NexGraph cô lập môi trường khi spawn (xem báo cáo). Các thư mục config giả đều là thư mục tạm, không đụng `~/.config/opencode` của người dùng.
- **Lưu ý:** các kịch bản không `hardened` (A–D, G) vẫn nạp config toàn cục thật của người dùng, gồm cả các MCP server đã cấu hình ở đó. Prompt không yêu cầu agent dùng chúng.
- Kết quả đã chạy: `results/`.
