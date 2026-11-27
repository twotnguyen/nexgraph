# Trợ lý AI trong không gian làm việc NexGraph

NexGraph dùng `@earendil-works/pi-coding-agent` 1.5.2 cho API key, ChatGPT và Ollama; kết nối tài khoản Google dùng Antigravity CLI chính thức qua ACP. Cây tệp ở bên trái, Monaco và sơ đồ ở giữa, trợ lý ở bên phải. Hai runtime cùng dùng công cụ, quyền, phạm vi mã nguồn và checkpoint của NexGraph. Nút **OpenCode** cấu hình một client OpenCode bên ngoài kết nối MCP của NexGraph; nó không chạy một OpenCode server thứ hai bên trong khung chat.

## Chạy từ mã nguồn

Cần Git, Node.js từ 22.19.0, pnpm 11.24.0 và uv. Từ thư mục gốc checkout:

```sh
pnpm run setup:dev
pnpm dev
```

Đợi **Engine: sẵn sàng**, mở thư mục và hoàn tất lập chỉ mục. Cây, tìm kiếm và sơ đồ hoạt động trước khi kết nối AI. Hướng dẫn cho máy mới và các lỗi Electron/Python nằm trong [install-notes.md](install-notes.md).

## 1. Kết nối tài khoản hoặc model

Bấm **Kết nối** trong khung trợ lý. Chọn một phương thức, hoàn tất xác thực, chọn **Model**, chạy **Kiểm tra kết nối và công cụ**, rồi bấm **Dùng kết nối**. Phép kiểm gửi một yêu cầu nhỏ tới model để kiểm streaming và một công cụ thử; đây là một lời gọi nhà cung cấp thật khi dùng tài khoản thật.

| Lựa chọn | Cách kết nối | Giới hạn cần hiểu |
| --- | --- | --- |
| ChatGPT | **Tài khoản → ChatGPT → Tiếp tục đăng nhập**, hoàn tất trình duyệt | Dùng nhà cung cấp OpenAI của Pi cùng adapter Sign in with ChatGPT của NexGraph. Hiện cần Plus/Pro đủ điều kiện, workspace cho phép và còn hạn mức chia sẻ. Hoàn tất trang web chưa có nghĩa bước đổi token hoặc gọi model đã thành công. |
| Claude | **API key → Anthropic** | Dùng Anthropic API key. Đăng nhập Claude Pro/Max bằng OAuth không được cung cấp cho chat tích hợp. |
| Gemini · Tài khoản Google | **Gemini → Tài khoản Google**, thiết lập Antigravity CLI rồi đăng nhập Google trong trình duyệt | Dùng quyền và hạn mức Antigravity của tài khoản. Hỗ trợ tài khoản cá nhân/Google AI Pro đủ điều kiện; NexGraph không tự xác nhận gói Pro chỉ từ việc đăng nhập. |
| Gemini · API key | **Gemini → API key**, dùng key từ Google AI Studio | Đây là Gemini API qua Pi, với quota/billing riêng. Gói Google AI Pro không thay thế API key hoặc cấp sẵn ngân sách Gemini API. |
| OpenRouter | **API key → OpenRouter** | Có cả model miễn phí và trả phí. Chọn đúng mục có giá phù hợp; model phải hỗ trợ gọi công cụ để sửa/test tự động. |
| Ollama | **Ollama local**, địa chỉ mặc định `http://localhost:11434/v1` | Ollama phải đang chạy và đã tải model. NexGraph tìm model từ máy chủ local; khả năng tool calling và cửa sổ ngữ cảnh phụ thuộc model/cấu hình Ollama. |
| OpenAI-compatible | **Cài đặt → Tài khoản AI → Nhà cung cấp tùy chỉnh** | Nhập Base URL, model và key nếu có. Endpoint phải hỗ trợ giao thức và công cụ cần dùng. Giá tùy chỉnh chưa khai báo được hiển thị là chưa xác định. |

API key và token OAuth của Pi được lưu bằng kho khóa mã hóa của NexGraph trên máy, không gửi qua renderer dưới dạng khóa thuần. Khi kho an toàn không khả dụng, OAuth của Pi báo lỗi thay vì tự lưu token thuần. Đổi key, đăng nhập hoặc xóa kết nối làm danh tính kết nối và sự đồng ý cũ hết hiệu lực; lịch sử của kết nối khác không tự ghép vào phiên mới.

### Gemini với tài khoản Google

Gemini CLI cũ đã ngừng phục vụ tài khoản cá nhân và Google AI Pro/Ultra từ **18/6/2026**. Đường được Google hỗ trợ cho các tài khoản này là **Antigravity CLI**, với server `agy acp` dành cho ứng dụng/editor bên ngoài. Không tiếp tục dùng Gemini CLI cũ hoặc đổi giả danh client để vượt lỗi `UNSUPPORTED_CLIENT`. [Thông báo chuyển đổi](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) · [Tích hợp ACP chính thức](https://antigravity.google/docs/ide/extensions/acp/).

1. Chọn **Gemini → Tài khoản Google → Thiết lập Antigravity CLI**. NexGraph tải binary chính thức đã ghim và kiểm hash trước khi cài vào thư mục dữ liệu. CLI này là chương trình native, không yêu cầu cài Node riêng. Máy chạy mã nguồn NexGraph vẫn cần môi trường dev như trên.
2. Chọn **Đăng nhập Google**, hoàn tất trình duyệt rồi quay lại NexGraph. CLI chính thức tự quản lý OAuth và refresh. NexGraph không đọc token Google để đưa sang Pi hoặc tự gọi backend riêng của Google.
3. Chọn model được CLI cung cấp, chạy **Kiểm tra kết nối và công cụ**. Phép kiểm chỉ dùng công cụ thử, chưa gửi mã nguồn dự án. Đăng nhập xong vẫn có thể bị thiếu quyền, model hoặc quota.
4. Đồng ý gửi ngữ cảnh dự án khi cần rồi chọn **Dùng tài khoản Google**. Header phân biệt **Gemini · Tài khoản Google** và **Gemini · API key**. Mỗi thay đổi model cần kiểm tra lại trước khi kích hoạt từ luồng kết nối.

CLI dùng thư mục cấu hình và thư mục làm việc do NexGraph quản lý dưới `antigravity/` trong dữ liệu engine. Token do CLI quản lý theo cơ chế lưu của nó, **không thuộc kho token mã hóa của Pi**. Không nhập hoặc sao chép token từ hồ sơ Google bên ngoài. Không coi thư mục cấu hình riêng là bảo đảm tài khoản OAuth riêng: CLI có thể dùng kho xác thực của hệ điều hành cùng với Antigravity đã cài. **Ngắt kết nối NexGraph** dừng runtime trong ứng dụng, không đăng xuất hoặc thu hồi tài khoản Google dùng bởi công cụ khác.

Sau mỗi lần mở NexGraph, kết nối Google phải được kiểm tra và kích hoạt lại; quyền gửi ngữ cảnh và lịch sử cũng phải được xác nhận lại cho dự án. Lịch sử cục bộ được giữ cùng kết nối, nhưng mã kết nối không phải danh tính Google đã được xác minh. Nếu đổi tài khoản trong Antigravity bên ngoài, ngắt kết nối NexGraph rồi kết nối lại trước khi gửi câu hỏi; ứng dụng không cung cấp bộ chuyển nhiều tài khoản Google độc lập.

CLI được cấp thư mục làm việc riêng, không phải gốc dự án. Các công cụ đọc/ghi tệp, shell và subagent mặc định bị loại bỏ; hook, skill, tệp ngữ cảnh và MCP của dự án nguồn không tự được nạp. Các tiện ích resource của CLI chỉ thấy MCP NexGraph, và cổng này không cung cấp resource để đọc tệp trực tiếp. Mã nguồn được đọc/ghi qua MCP loopback có token riêng của NexGraph, áp dụng cùng phạm vi tệp, duyệt thay đổi và quyền chạy lệnh. Đường đọc/ghi/terminal ACP trực tiếp bị từ chối. Không dùng chế độ yolo toàn cục.

Khi Google báo lỗi hoặc hết hạn mức, NexGraph giữ kết nối đã chọn và báo lỗi; không tự chuyển sang API key có thể phát sinh phí. Xem [xác thực](https://antigravity.google/docs/authentication) và [ACP](https://antigravity.google/docs/ide/extensions/acp/) của Antigravity.

Adapter ChatGPT dùng callback HTTP loopback trên `127.0.0.1` với cổng trống, PKCE và state/nonce riêng cho từng lần xác nhận. Nó kiểm chữ ký ID token qua JWKS của OpenAI, issuer, audience, hạn dùng, nonce, danh tính `sub` và quyền `chatgpt.tokens.use.direct` trước khi chấp nhận token. Nếu đổi code trả `invalid_grant`, lần xác nhận mới dùng code/PKCE mới và client ID vừa được cấp; không gửi lại code cũ. Pi tiếp tục quản lý refresh và gọi Responses API. [Giao thức đăng ký và xác nhận chính thức](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

## 2. Chọn chế độ và quyền thực thi

| Chế độ | Hành vi |
| --- | --- |
| **Hỏi** | Đọc mã, tìm kiếm và tra đồ thị. Không ghi tệp, không chạy lệnh. |
| **Kế hoạch** | Cùng quyền chỉ đọc; yêu cầu kế hoạch có tệp liên quan và kiểm thử dự kiến. |
| **Sửa** | Cho phép công cụ sửa/tạo tệp. Quyền chạy lệnh và cách duyệt được chọn riêng trong **Quyền & giới hạn**. |

Mặc định **Duyệt từng thay đổi**: mỗi thao tác ghi hiển thị đường dẫn cùng diff trước/sau. Lệnh được duyệt bằng executable, args, cwd và timeout. **Tự động trong phiên này** bỏ bước duyệt từng thao tác trong phạm vi đã cấp; **lệnh thì luôn phải duyệt từng lệnh** và vẫn cần bật **Cho phép chạy lệnh build/test** riêng (ADR 0016). Hỏi và Kế hoạch luôn chỉ đọc, kể cả khi trước đó đã bật quyền tự động.

**Web (Nex):** Nex có thể tìm trên web và mở một trang để tra tài liệu thư viện hay thông báo lỗi. Mỗi lần đều hiện hộp duyệt kèm nguyên văn câu tìm hoặc URL, ở cả ba chế độ (web không ghi tệp dự án), kể cả khi đã bật **Tự động trong phiên này**. Đọc kỹ trước khi cho phép: câu tìm và URL đi ra ngoài máy, nên một tệp chứa chỉ dẫn độc có thể lợi dụng chúng để gửi dữ liệu dự án đi. Câu tìm được gửi tới dịch vụ tìm kiếm Exa; trang được mở trực tiếp từ máy bạn.

Quyền tự động và chạy lệnh không được bật lại khi đóng rồi mở dự án. Công cụ chạy tiến trình bằng executable và mảng args, không diễn giải chuỗi shell chung. Tiến trình dùng quyền tài khoản Windows/macOS hiện tại; đây không phải máy ảo hay sandbox của hệ điều hành. Script của dự án có thể có tác động ngoài mã nguồn mà checkpoint không hoàn tác được.

## 3. Gửi ngữ cảnh đúng vị trí

Mở tệp ở giữa rồi dùng thao tác thêm tệp đang mở vào câu hỏi. Có thể đính kèm vùng dòng hoặc đối tượng sơ đồ được giao diện hỗ trợ. Khi bản nháp chưa lưu được chọn làm ngữ cảnh, nội dung đính kèm thể hiện bản nháp; đồ thị vẫn thể hiện lần lập chỉ mục gần nhất. Trợ lý phải đọc lại mã trước khi đề xuất sửa.

Mỗi lượt nhận tối đa 12 mục ngữ cảnh, trong tổng giới hạn 32.000 ký tự. Nội dung bị cắt có đánh dấu. Công cụ đọc mã và ngữ cảnh tuân theo phạm vi tệp được phép cho AI; đường dẫn ngoài dự án, tệp bí mật bị chặn, thư mục phụ thuộc và các mẫu loại trừ không được đưa vào kết quả. Thư mục dự án không tự nạp extension, skill hoặc lệnh từ `.pi`, `AGENTS.md` hay `CLAUDE.md` để thực thi trong Pi.

Tệp có bản nháp Monaco chưa lưu được bảo vệ trước thao tác ghi hoặc hoàn tác của AI. Lưu bản nháp hoặc đóng nó trước khi yêu cầu trợ lý thay đổi tệp đó. Khi tệp trên đĩa đổi trong lúc chờ duyệt, NexGraph giữ phiên bản mới và báo xung đột để đọc/duyệt lại.

**Tin nhắn đã lưu**: nút đánh dấu ở ô soạn (hoặc lệnh `/saved`) lưu nội dung ô soạn thành một mục có tên, tối đa 50 mục, ghi trên máy theo khóa `nexgraph.agent.savedPrompts` nên còn sau khi khởi động lại và dùng chung mọi dự án. Chọn một mục để chèn vào chỗ con trỏ của ô soạn; thùng rác xóa mục. Lưu cùng tên thì thay nội dung mục cũ.

## 4. Lịch sử và tiếp tục tác vụ

**+ Phiên mới** tạo một hội thoại riêng. **Lịch sử** cho mở lại, đổi tên hoặc xóa hội thoại của kết nối đang chọn. Đóng rồi mở ứng dụng khôi phục phiên đang chọn; không tự chạy lại tác vụ dở dang. Tác vụ bị gián đoạn được đánh dấu đã dừng. Gemini dùng `session/load` với mã phiên native do CLI cấp; NexGraph chỉ liệt kê các phiên do ứng dụng tạo. Đổi tên và xóa là thao tác trên chỉ mục/lịch sử cục bộ NexGraph, không phải xóa dữ liệu phía Google hoặc toàn bộ phiên lưu bởi CLI.

Lịch sử được tách theo dự án, gốc thư mục thực, runtime, nhà cung cấp, endpoint hoặc kết nối Google. Đổi model trong cùng kết nối có thể tiếp tục hội thoại; đổi kết nối hoặc endpoint không đưa lịch sử cũ sang đích mới. Không nhập lịch sử từ `~/.pi`, `~/.gemini` hay thư mục dự án.

Dữ liệu Pi nằm dưới `agent/sessions/<scope>/`; tài khoản Google có chỉ mục, transcript, tác vụ và checkpoint riêng dưới `antigravity/sessions/`, cùng kho phiên native của CLI. Hội thoại và mã nguồn đính kèm là dữ liệu cục bộ trên đĩa; cơ chế mã hóa token không đồng nghĩa transcript đã được mã hóa. Bản ghi hỏng hoặc không khớp gốc dự án báo lỗi và được giữ lại để khôi phục, không bị âm thầm thay bằng lịch sử trống.

## 5. Sửa, xem diff và hoàn tác

Một tác vụ Sửa có thể kết hợp chỉnh tệp và chạy test, dựa trên quyền đã chọn. **Xem thay đổi** mở diff trong vùng làm việc ở giữa. **Hoàn tác** chỉ áp dụng các checkpoint của tác vụ được chọn; không yêu cầu dự án có Git.

Checkpoint giữ bản gốc trước lần sửa đầu và bản cuối sau các lần ghi của cùng tác vụ. Với lệnh, NexGraph đối chiếu mã nguồn văn bản được phép trước/sau tiến trình, gồm tạo và xóa tệp. Thu thập bị giới hạn 32 MiB và bỏ qua tệp bí mật, binary, dependency cùng đường dẫn sinh tự động. Kết quả công cụ ghi cảnh báo nếu phạm vi checkpoint không đầy đủ.

Hoàn tác kiểm tra phiên bản hiện tại trước khi ghi. Nếu người dùng đã sửa tiếp, tệp đó được giữ nguyên và báo xung đột; các tệp còn đủ điều kiện vẫn có thể khôi phục. Sau sửa hoặc hoàn tác thực tế, NexGraph yêu cầu cập nhật đồ thị. Nếu engine chưa cập nhật được, thay đổi tệp vẫn được giữ và ứng dụng báo cần lập chỉ mục lại.

## 6. Chạy test và đọc kết quả công cụ

Trong **Quyền & giới hạn**, **Nhận diện lệnh dự án** đọc script `test`, `lint`, `typecheck`, `check`, `build` của `package.json`, hoặc gợi ý pytest theo tệp cấu hình Python. Nó không tự cài dependency hay tự chạy script khi chỉ mở dự án.

Bật quyền chạy lệnh trong chế độ Sửa, rồi yêu cầu chạy một kiểm tra cụ thể. Công cụ trả exit code, stdout/stderr, thời gian, timeout và trạng thái bị hủy. Exit code khác 0 là kết quả thất bại để model phân tích và sửa tiếp; không được coi việc khởi động được tiến trình là test đã qua. Mỗi lệnh có timeout, tối đa 5 phút; stdout/stderr được giới hạn 64 KiB.

Không kế thừa key của provider từ môi trường NexGraph vào tiến trình. Các kiểm tra cần dịch vụ, dependency hoặc cấu hình riêng vẫn phải được chuẩn bị trong môi trường dự án. Công cụ không tự cấp quyền cài gói, phát hành hay push Git.

## 7. Theo dõi tác vụ, ngân sách và chi phí

Khung trợ lý hiển thị tác vụ đang chạy/chờ duyệt/hoàn tất/thất bại/đã dừng, số lượt mô hình và các công cụ với args, kết quả cùng thời lượng. **Mở ở vùng làm việc** đưa kết quả dài sang giữa. Thông tin công cụ được giới hạn kích thước và che các khóa đã nhận diện.

Với Pi, mặc định một tác vụ có 30 lượt gọi mô hình, 10 phút và 120.000 token. Có thể đổi trong **Quyền & giới hạn** khi không có tác vụ đang chạy. Đạt giới hạn thời gian/lượt gọi sẽ dừng công việc; **Dừng** hủy suy luận, từ chối yêu cầu duyệt còn chờ và dừng cây tiến trình của tác vụ.

Token được cộng từ usage nhà cung cấp báo sau mỗi phản hồi. Khi API hỗ trợ, NexGraph đặt giới hạn output còn lại; một request đang chạy vẫn có thể vượt tổng ngân sách do input và quy tắc API. Sign in with ChatGPT không nhận trường `max_output_tokens`, nên SDK bỏ trường này; ngân sách token không phải trần thanh toán cứng của nhà cung cấp. Các lượt gọi đã hoàn tất vẫn được ghi usage nếu phần còn lại của tác vụ bị hủy.

Chi phí chỉ là ước tính khi có bảng giá model. Model tùy chỉnh không có giá, tài khoản subscription và Ollama local hiển thị **Chi phí: chưa xác định**, không giả thành `$0`. Model có giá miễn phí được khai báo rõ mới hiển thị 0; hạn mức tài khoản vẫn có thể áp dụng.

Với Antigravity CLI, NexGraph thực thi giới hạn thời gian và nút Dừng. Không áp dụng giả giới hạn số lượt/token của Pi cho CLI khi giao thức không hỗ trợ. Khi ACP không báo số lượt hoặc token thực tế, giao diện không suy ra chúng từ số lần gọi công cụ. `usage_update.used/size` là mức dùng cửa sổ ngữ cảnh, không phải quota ngày. Chi phí và quota Google không được tự ước lượng; usage CLI báo không phải trần thanh toán cứng của tài khoản.

**Vòng context** ở dòng chân khung chat hiện % ngữ cảnh của phiên đang mở (vàng từ 75%, đỏ từ 90%); rê chuột để xem `x / y token (z%)`. Với Pi, số lấy từ `getContextUsage()` của SDK (usage của phản hồi gần nhất cộng ước tính phần tin mới) chia cho cửa sổ của model đang chọn; model tùy chỉnh chưa khai báo cửa sổ thì ẩn vòng thay vì dùng giá trị mặc định 4096. Với Antigravity CLI, số lấy từ `usage_update` mà CLI gửi trong lượt chạy và được lưu cùng hội thoại. Không có số tin cậy (phiên trống, vừa tóm tắt, backend không báo) thì không có vòng, không hiện 0% giả.

**Thông báo khi xong**: khi một lượt trả lời xong, gặp lỗi hoặc chờ duyệt thay đổi mà cửa sổ NexGraph không được chọn, ứng dụng hiện thông báo hệ thống mang tên hội thoại (bấm vào để đưa cửa sổ lên) và, nếu bật, phát một tiếng chuông ngắn riêng cho từng loại. Dừng bằng nút **Dừng** không báo. Hai công tắc nằm ở **Cài đặt → Trợ lý AI → Khi trợ lý xong**; mặc định bật thông báo, tắt âm thanh.

## 8. Lỗi và cách kiểm chứng

- **401/403**: kiểm tra key, tài khoản hoặc quyền dùng model. Đăng nhập lại khi nhà cung cấp yêu cầu.
- **429**: kiểm tra quota/rate limit; retry của SDK có giới hạn và vẫn chịu ngân sách tác vụ. Lặp yêu cầu không tạo thêm quota.
- **Trang ChatGPT khóa Tiếp tục, chỉ cho Nâng cấp/Hủy**: tài khoản/workspace/gói đang chọn thiếu quyền dùng gói cho ứng dụng. Hủy luồng và chọn tài khoản đủ điều kiện hoặc phương thức AI khác; không lặp OAuth để cố vượt quyền. [Điều kiện sử dụng gói ChatGPT](https://developers.openai.com/siwc/quickstart).
- **`invalid_grant` khi đăng nhập ChatGPT**: phiên đổi token chưa thành công. Thử lại từ luồng đăng nhập mới và kiểm tra tài khoản đủ điều kiện; không coi màn hình trình duyệt hoàn tất là đã kết nối.
- **Đích nhận đã thay đổi**: kiểm tra lại tài khoản/endpoint và xác nhận gửi dữ liệu tới đích mới. Lượt cũ bị dừng.
- **Checkpoint xung đột**: giữ thay đổi hiện tại, đọc diff và đối chiếu thủ công; không ghi đè bản người dùng chỉ để khôi phục tự động.
- **Lịch sử hỏng/thiếu tệp**: giữ bản sao dữ liệu trước khi xử lý; không xóa kho token hoặc toàn bộ dữ liệu chỉ để bỏ thông báo lỗi.
- **Antigravity CLI chưa thiết lập**: dùng nút thiết lập trong kết nối Gemini, cần mạng để tải binary đã ghim. Lỗi kiểm hash không được bỏ qua bằng cách chạy gói chưa xác minh.
- **Google đã đăng nhập nhưng kiểm tra thất bại**: đọc lỗi quyền, quota hoặc mạng rồi thử lại; chưa kích hoạt cho dự án khi công cụ chưa được xác nhận. Nếu CLI yêu cầu xác thực lại, đăng nhập lại trong luồng Google.

Các kiểm thử tự động dùng Pi SDK, ACP transport, broker MCP và CLI chính thức được ghim. Chúng xác nhận giao thức, lưu/khôi phục lịch sử, cách ly kết nối, quyền ghi/chạy lệnh, checkpoint và giới hạn. Chúng không thay thế nghiệm thu token/model thật của từng nhà cung cấp. Đăng nhập Google hoặc ChatGPT thật cần kiểm riêng trên tài khoản của người dùng; chưa được coi là đạt chỉ vì test giả lập đã qua.

Các tệp kiểm thử chính: `apps/desktop/test/agent-session-pi.test.ts`, `agent-session.test.ts`, `agent-session-store.test.ts`, `task-execution.test.ts`, cùng smoke Electron trong `apps/desktop/src/main/app/smoke-desktop.ts`.
