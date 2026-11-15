# Spike pi coding-agent SDK + Monaco trong Electron (Task 0)

**Ngày:** 2026-11-15 · **Máy:** MacBook Apple Silicon, macOS 15.7 (darwin-arm64). Chưa chạy trên Windows.
**Mã spike:** nhánh `spike/pi-monaco` (worktree `nexgraph-spike-pi`, commit `8210429`, `3f183c6`), không merge.

Quy ước: **[chạy]** = đã quan sát khi chạy lệnh; **[nguồn]** = đọc từ mã nguồn pi (clone tại `pi/`, cùng bản 1.5.2 với bản cài), kèm `file:dòng` tính từ `pi/packages/`; **[chưa kiểm]** = không kiểm được ở đây.

## Phiên bản đã cài (đã chạy)
| Gói | Phiên bản |
|---|---|
| electron | 44.9.3 (Chrome 152.0.7977.167) |
| **Node trong main của Electron 44** | **24.22.0** (`process.versions.node`), đạt yêu cầu pi ≥ 22.19.0 (`coding-agent/package.json:94`) |
| Node ngoài Electron (máy dev) | 26.7.0 |
| `@earendil-works/pi-coding-agent` | 1.5.2 (cùng bản `pi-ai` 1.5.2) |
| `monaco-editor` | 0.57.0 |
| `typebox` | 1.3.27 (phải thêm làm dependency trực tiếp, xem (a)) |

## Cách kiểm
- **Không có API key thật** (môi trường chỉ có `FIRECRAWL_API_KEY`, không dùng). Theo quyết định đã chốt, dựng một máy chủ HTTP giả tương thích OpenAI (`/v1/chat/completions`, streaming SSE, có `tool_calls`) ngay trong `apps/desktop/src/main/spike.ts` rồi đăng ký với pi bằng `pi.registerProvider`. **Hành vi với nhà cung cấp thật chưa kiểm** (chỉ kiểm giao thức OpenAI chat-completions streaming qua máy chủ giả; không kiểm xác thực thật, giới hạn tốc độ, hay khác biệt giữa các nhà cung cấp).
- Kiểm không cần giao diện: `NEXGRAPH_SPIKE=1` → main chạy phiên pi, rồi mở một `BrowserWindow` ẩn nạp renderer với `#monaco-spike`, đọc kết quả bằng `executeJavaScript`, in ra stdout rồi thoát. Lệnh: `NEXGRAPH_SPIKE=1 npx electron .` (dev) và `NEXGRAPH_SPIKE=1 dist/mac-arm64/NexGraph.app/Contents/MacOS/NexGraph` (đóng gói).
- Phiên pi dùng `agentDir` và `ModelRuntime` (`authPath`, `modelsPath`) trong thư mục tạm, không đụng `~/.pi` của máy.

## (a) SDK trong main: **được**, với hai điều kiện
Chạy dev, kết quả thật:
```
electron=44.9.3 node=24.22.0 chrome=152.0.7977.167 platform=darwin-arm64
active tools=read,ping,bash
tool_call ping input={"msg":"hi"}
tool_call bash input={"command":"echo pwned"}
ping.execute msg=hi
text_delta count=2 text="Xong rồi."
systemPrompt has marker=true
server: POST /v1/chat/completions tools=read,ping,bash hasToolResult=false
server: POST /v1/chat/completions tools=read,ping,bash hasToolResult=true
toolResults=[{"type":"text","text":"pong"}] | [{"type":"text","text":"bash bị chặn trong spike"}]
```
Đã xác nhận [chạy]: tool tự đăng ký `ping` được gọi và `execute` chạy; `bash` bị chặn bởi `pi.on("tool_call")` trả `{ block: true, reason }` và lý do quay lại model làm nội dung tool result; `session.subscribe` nhận `message_update` với `assistantMessageEvent.type === "text_delta"` (2 delta); `pi.registerProvider` trong `extensionFactories` dùng được; `session.setModel(modelRuntime.getModel("fake","fake-1"))` dùng được.

Lỗi gặp và điều kiện:
1. **`require()` thất bại.** electron-vite xuất main dạng CJS (`package.json` không có `"type":"module"`). `import … from '@earendil-works/pi-coding-agent'` tĩnh bị biên dịch thành `require(...)` và app sập khi nạp:
   `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in …/@earendil-works/pi-coding-agent/package.json`.
   Nguyên nhân [nguồn]: `exports["."]` chỉ có điều kiện `types` và `import`, không có `require` (`coding-agent/package.json:14-18`). **Cách khắc phục đã chạy:** nạp bằng `await import('@earendil-works/pi-coding-agent')` trong main (rolldown giữ nguyên `import()` cho gói được externalize); chỉ dùng `import type` ở nơi khác. Task 4–7 phải đi qua một module bọc duy nhất làm dynamic import, không import tĩnh pi ở bất cứ đâu trong `src/main`.
2. **`typebox` không export lại từ pi** ([nguồn] `coding-agent/src/index.ts` không export `Type`). Tool tùy biến cần `Type.Object(...)` nên phải `pnpm add typebox@1.3.27` (đúng bản pi dùng, `coding-agent/package.json:63`). `typebox` nạp được bằng `require` (không lỗi ở dòng 33 của bundle).
3. **pnpm 11 từ chối `pnpm install`** sau khi thêm pi: `ERR_PNPM_IGNORED_BUILDS: @google/genai@2.21.0, protobufjs@7.6.6`, và mọi lệnh `pnpm` sau đó (kể cả `pnpm build`) dừng vì kiểm tra trạng thái phụ thuộc. pnpm tự thêm vào `pnpm-workspace.yaml` hai mục `'@google/genai': set this to true or false`, `protobufjs: set this to true or false`. Đã sửa thành `false` (spike không cần script cài đặt của chúng) [chạy]; Task 4 phải commit hai dòng `allowBuilds` này.
4. Cảnh báo không chặn: pnpm báo 5 deprecated subdependencies (`boolean`, `glob@7`, `inflight`, `node-domexception`, `rimraf@2`).

Phát hiện thêm ảnh hưởng thiết kế:
- **`tools` là allowlist cho cả tool của extension.** Với `tools: ["read"]`, model gọi `ping` nhận `Tool ping not found` (và `bash` cũng vậy) [chạy]. Muốn dùng tool tự đăng ký phải liệt kê tên của nó trong `tools` (đã chạy với `tools: ["read","ping","bash"]`). Chú thích kiểu: `tools?: string[]` (`coding-agent/src/core/sdk.ts:87`).
- `providers with oauth=9/44` [chạy]: `ModelRuntime.getProviders()` trả 44 nhà cung cấp, 9 có `auth.oauth`.

## (b) Đóng gói: **được**
Lệnh: `pnpm --filter @nexgraph/desktop package:dir` (chạy trong `apps/desktop`). `engine/dist/nexgraph-engine` không có trên máy nên tạo một thư mục giả (một tệp `stub.txt`) để `extraResources` không lỗi; không ảnh hưởng phép đo của pi/Monaco.

| | `NexGraph.app` (`du -sh`) | `app.asar` |
|---|---|---|
| Trước (chưa thêm pi, Monaco) | **319 MB** | không đo |
| Sau (pi + Monaco + typebox) | **537 MB** (+218 MB) | 224 MB (giải nén: `node_modules` 234 MB, `out` 23 MB) |

Thành phần trong asar sau [chạy: `du -sk` trên asar đã giải nén]: `monaco-editor` 100 MB, `@earendil-works` 34 MB (`pi-coding-agent` 23 MB, `pi-ai` 6 MB), `openai` 23 MB, `@anthropic-ai/sdk` 12 MB, `web-streams-polyfill` 9 MB, `@google/genai` 8 MB, `typebox` 6 MB.
- **`monaco-editor` 100 MB là thừa:** Vite đã gói nó vào renderer (`out/renderer/assets/`: `ts.worker` 11,5 MB, `editor.api` 5,1 MB, `tsMode` 2,2 MB…), nhưng vì nằm ở `dependencies` nên electron-builder chép cả thư mục gói vào asar. Đề xuất: đặt `monaco-editor` vào `devDependencies`, ước tính giảm ~100 MB (**chưa đo lại sau khi đổi**).
- Chưa tạo `.dmg`/`.exe` nên chưa có kích thước bộ cài nén; con số trên là thư mục ứng dụng chưa nén.

Chạy bản đóng gói (`NexGraph.app/Contents/MacOS/NexGraph` với `NEXGRAPH_SPIKE=1`) lặp lại Step 2 và 3 [chạy]: đầu ra phiên pi giống hệt bản dev (cùng các dòng `tool_call ping`, `ping.execute`, `text_delta count=2`, `bash` bị chặn), và Monaco:
```
{"tsLang":"typescript","pyLang":"python","tsTokenClasses":["mtk6","mtk1","mtk7","mtk1 bracket-highlighting-0",""],
 "pyTokenClasses":["mtk6","mtk1","mtk1 bracket-highlighting-0","mtk8",""],
 "tsMarkers":["Argument of type 'number' is not assignable to parameter of type 'string'."]}
```
Tức tệp `.ts` và `.py` được tô cú pháp (nhiều lớp `mtkN` khác nhau), và worker TypeScript chạy (có marker lỗi kiểu) dưới `file://` trong asar.

Monaco (Step 3) [chạy, cả dev và đóng gói]:
- Import theo `exports` của monaco-editor 0.57 (`"./*": "./esm/vs/*.js"`): đường dẫn là `monaco-editor/editor/editor.api.js`, **không** có `esm/vs/` (đường dẫn `monaco-editor/esm/vs/...` gây `Rolldown failed to resolve import`). Ngôn ngữ nằm ở `monaco-editor/languages/definitions/{python,typescript}/register.js` (không còn `basic-languages/`) và `monaco-editor/language/typescript/monaco.contribution.js`.
- Worker theo Vite: `import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'` và `…/language/typescript/ts.worker.js?worker`, gán `self.MonacoEnvironment.getWorker`. CSP hiện tại (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`) **không** chặn worker hay Monaco.
- Nếu quên nạp `languages/definitions/typescript/register.js` thì `.ts` ra `plaintext` (đã gặp, đã sửa).
- Phát hiện sẵn có, không do spike: CSP `default-src 'self'` chặn các font `data:` (woff/woff2 base64) do Vite inline từ `@fontsource`; console báo `Loading the font 'data:font/…' violates … Content Security Policy`. Cần thêm `font-src 'self' data:` nếu muốn font nạp được. Đã lọc dòng này khỏi log spike.
- Chỉ kiểm bằng cửa sổ ẩn và đọc DOM; chưa nhìn bằng mắt (không chụp ảnh màn hình).

## (c) `bash` trên Windows: **chưa kiểm, chờ P3 chạy trên Windows**
Máy này là macOS nên Step 5 không làm được. Từ nguồn:
- Cách pi tìm shell, `getShellConfig` (`coding-agent/src/utils/shell.ts:86-142`): (1) `shellPath` do người dùng đặt, không tồn tại thì ném `Custom shell path not found` (`:88-93`); (2) trên Windows: `%ProgramFiles%\Git\bin\bash.exe` rồi `%ProgramFiles(x86)%\Git\bin\bash.exe` (`:96-111`); (3) `bash.exe` trên `PATH` (Cygwin, MSYS2, WSL) (`:114-117`); không thấy thì ném lỗi `No bash shell found` kèm gợi ý cài Git for Windows hoặc đặt `shellPath` (`:119-125`). Unix: `/bin/bash`, rồi `bash` trên `PATH`, rồi `sh` (`:129-139`).
- Tài liệu: `coding-agent/docs/shell-aliases.md:16` và `docs/settings.md:142` (`shellPath`, hỗ trợ `~` đầu chuỗi).
- Có tool `powershell` riêng chỉ cho Windows (`shell.ts:144-170`, `docs/cli.md:146`), dùng `pwsh.exe` rồi Windows PowerShell; không cần Git Bash. Chưa rõ tool này có trong tập mặc định hay không (chưa đọc).
- Hệ quả cần P3 kiểm: máy Windows không cài Git for Windows thì tool `bash` ném lỗi tìm shell. Với NexGraph, phương án an toàn là **không bật `bash`** (agent chỉ đọc/sửa tệp qua `read`/`edit`/`write` và chặn `bash` bằng `tool_call`), nên lỗi này không ảnh hưởng nếu chặn `bash` hoặc không liệt kê nó trong `tools`. P3 cần kiểm: (1) `tools: ["read"]` chạy được trên Windows không cần Git; (2) `tools: ["read","bash"]` không chặn có chạy với/không Git for Windows; (3) đường dẫn có dấu tiếng Việt và dấu `\`.

## (d) Hình dạng `event.input` của `edit` và `write`
Kiểu [nguồn] `coding-agent/src/core/extensions/types.ts:1241-1249`:
```ts
export interface EditToolCallEvent extends ToolCallEventBase { toolName: "edit"; input: EditToolInput }
export interface WriteToolCallEvent extends ToolCallEventBase { toolName: "write"; input: WriteToolInput }
// ToolCallEventBase (:1214-1223): { type: "tool_call"; toolCallId: string; parentToolCallId?: string }
```
Thân kiểu, suy ra từ schema TypeBox (`tools/edit.ts:18-48`, `tools/write.ts:10-20`):
```ts
type EditToolInput  = { path: string; edits: { oldText: string; newText: string }[] }
type WriteToolInput = { path: string; content: string }
```
- `path` là chuỗi "relative or absolute" (mô tả schema), **không được chuẩn hóa thành tuyệt đối** trước sự kiện: model gửi `a.txt` thì handler thấy `a.txt` [chạy]. Handler phải tự `path.resolve(cwd, input.path)` khi so với thư mục dự án.
- `event.input` **có thể sửa tại chỗ** để vá đối số (`types.ts:1274-1275`, không kiểm lại sau khi sửa). `isToolCallEventType("edit"|"write", event)` thu hẹp kiểu (`types.ts:1412-1413`).
- Đầu vào dạng cũ `{ path, oldText, newText }` được `prepareArguments` đổi thành `edits[]` **trước** khi phát `tool_call` [chạy]: server giả gửi `edit {"path":"a.txt","oldText":"hello","newText":"bye"}` và handler nhận
  `tool_call edit input={"path":"a.txt","edits":[{"oldText":"hello","newText":"bye"}]}`;
  `write` nhận `input={"path":"b.txt","content":"x"}`. Nguồn: `tools/edit.ts:110-128`, `:153`.
- Kết quả handler: `ToolCallEventResult = { block?: boolean; reason?: string; terminate?: boolean }` (`types.ts:1475-1485`).
- Với nhà cung cấp thật, dạng `edits` có thể là chuỗi JSON hoặc đối tượng đơn; `prepareEditArguments` xử lý cả hai (`edit.ts:110-117`), chưa kiểm bằng model thật.

## (e) `modelRuntime.login`: chữ ký, kiểu, liệt kê nhà cung cấp OAuth
Chỉ đọc nguồn, **không thực hiện đăng nhập OAuth nào**. `coding-agent/src/core/model-runtime.ts:863-875`:
```ts
login(providerId: string, type: AuthType, interaction: AuthInteraction, options?: LoginOptions): Promise<Credential>
```
Kiểu trong `ai/src/auth/types.ts`:
```ts
export type AuthType = "api_key" | "oauth";                                   // :117

export type AuthPrompt = { signal?: AbortSignal } & (                          // :122-
  | { type: "text";        message: string; placeholder?: string }
  | { type: "secret";      message: string; placeholder?: string }
  | { type: "select";      message: string; options: readonly { id: string; label: string; description?: string }[] }
  | { type: "manual_code"; message: string; placeholder?: string });

export type AuthEvent =
  | { type: "info"; message: string; links?: readonly { url: string; label?: string }[] }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string; openBrowserOnConfirm?: boolean;
      copyCodeOnConfirm?: boolean; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: "progress"; message: string };

export interface AuthInteraction {                                              // :160
  signal?: AbortSignal;
  prompt(prompt: AuthPrompt): Promise<string>;   // select trả id lựa chọn; reject khi hủy
  notify(event: AuthEvent): void;
}

export interface LoginOptions {                                                 // :206-218
  getDeviceId?: () => string;   // ID ổn định của bản cài, trả cùng giá trị mọi lần
  agentName?: string;           // tên app tự giới thiệu khi đăng nhập; mặc định tên pi
}
```
- `login` trả `Credential = ApiKeyCredential | OAuthCredential` (`types.ts:37`), serialize hóa theo từng nhà cung cấp, và ghi `auth.json` qua `synchronizeCredentialState` (`model-runtime.ts:870-872`). `logout(providerId, { signal })` ở `:877`.
- `interaction.signal` hủy cả luồng; `AuthPrompt.signal` hủy một prompt (vd `manual_code` đua với callback server). Renderer của NexGraph phải cầu nối: `notify` → IPC xuống renderer (hiển thị `auth_url`, `device_code`), `prompt` → IPC hỏi và đợi trả lời.
- **Liệt kê nhà cung cấp có OAuth:** `modelRuntime.getProviders()` (`model-runtime.ts:442`) rồi lọc `p.auth.oauth` (`ProviderAuth = { apiKey?: ApiKeyAuth; oauth?: OAuthAuth }`, `types.ts:256-259`; `OAuthAuth` có `name`, `isSubscription?`, `loginLabel?`, `login`, `refresh`, `toAuth`). Đã chạy [chạy]:
```
anthropic:Anthropic (Claude Pro/Max)          apiKey=true
github-copilot:GitHub Copilot                 apiKey=true
kimi-coding:Kimi Code (subscription)          apiKey=true
meta:Meta (Muse subscription)                 apiKey=true
openai:OpenAI (ChatGPT subscription)          apiKey=true
openai-codex:OpenAI (ChatGPT Plus/Pro)        apiKey=false   (chỉ OAuth)
openrouter:OpenRouter OAuth                   apiKey=true
radius:Radius                                 apiKey=true
xai:xAI (Grok/X subscription)                 apiKey=true
```
  (9 trong 44 nhà cung cấp; danh sách phụ thuộc bản pi, đừng cứng hóa.) Loại đăng nhập hợp lệ của một nhà cung cấp: `p.auth.apiKey ? "api_key"` và/hoặc `p.auth.oauth ? "oauth"`; `login(id, "api_key", …)` chỉ khi `apiKey.login` tồn tại (nhà cung cấp chỉ dùng biến môi trường không có `login`, `types.ts:174-185`).
- Cách khác không đi qua `login`: `modelRuntime.setRuntimeApiKey(providerId, key)` (`examples/sdk/09-api-keys-and-oauth.ts:30`), khóa chỉ trong bộ nhớ.

## (f) Nối thêm system prompt
Dùng `appendSystemPromptOverride` của `DefaultResourceLoader` (`resource-loader.ts:340`), kiểu `(base: string[]) => string[]`; nhận danh sách đoạn nối mặc định (từ `APPEND_SYSTEM.md` ở `~/.pi/agent` hoặc `<cwd>/.pi`) và trả danh sách mới (`resource-loader.ts:695-706`). Ví dụ gốc `examples/sdk/03-custom-prompt.ts` (Option 2, từ dòng 47):
```ts
const loader = new DefaultResourceLoader({
  cwd, agentDir,
  appendSystemPromptOverride: (base) => [...base, "## Additional Instructions\n- Always be concise"],
});
await loader.reload();                       // bắt buộc trước createAgentSession
const { session } = await createAgentSession({ resourceLoader: loader, sessionManager: SessionManager.inMemory() });
```
Đã chạy [chạy]: với `[...base, 'SPIKE-APPEND-MARKER']`, `session.systemPrompt.includes('SPIKE-APPEND-MARKER') === true`. Thay hẳn prompt: `systemPromptOverride: () => "…"` kèm `appendSystemPromptOverride: () => []` để không dính `APPEND_SYSTEM.md` của người dùng (`03-custom-prompt.ts`, Option 1). Với NexGraph nên **nối** (giữ phần mô tả tool của pi) và truyền `agentDir` riêng trong dữ liệu ứng dụng, để không đọc `~/.pi` của máy.

## (g) `ProviderConfigInput` tối thiểu cho endpoint tương thích OpenAI
Kiểu [nguồn] `coding-agent/src/core/provider-composer.ts:93-108`: `{ name?, baseUrl?, apiKey?, api?, streamSimple?, images?, classifiers?, headers?, authHeader?, oauth?, models?, refreshModels? }`; mỗi mô hình chat (`:63-77`) bắt buộc `id`, `name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`. Cấu hình đã chạy [chạy], trong `pi.registerProvider` của extension factory:
```ts
pi.registerProvider('fake', {
  name: 'Fake',
  baseUrl: 'http://127.0.0.1:<cổng>/v1',
  apiKey: 'fake-key',               // chuỗi, "$ENV", hoặc "!lệnh" (docs/models.md:45-63)
  api: 'openai-completions',
  models: [{
    id: 'fake-1', name: 'Fake 1', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000, maxTokens: 4096
  }]
})
```
Sau đó `modelRuntime.getModel('fake','fake-1')` tìm thấy và `session.setModel(...)` chọn được. Các lưu ý:
- Máy chủ giả nhận `POST /v1/chat/completions` đúng dạng OpenAI, kèm danh sách `tools`, và truyền lại `tool` message ở lượt 2 [chạy]. Mô hình gọi tool song song (hai `tool_calls` trong một phản hồi) chạy được.
- **Cách không cần mã:** `models.json` trong `agentDir`, cùng nội dung ở dạng JSON, mô hình chỉ cần `{ "id": "…" }` (`docs/models.md:45-63`, `docs/custom-provider.md`: "Prefer `models.json` when no executable extension behavior is needed"). Chưa chạy đường `models.json` trong spike này; chỉ đọc tài liệu. Với NexGraph (người dùng nhập Base URL, khóa, model trong Cài đặt) `registerProvider` tại runtime (hoặc ghi `models.json`) đều khả thi; `registerProvider` đã được kiểm.
- Chỉ khai `baseUrl` hoặc `headers` cho một nhà cung cấp có sẵn thì giữ nguyên catalog mô hình (`docs/custom-provider.md`, mục "Redirect an existing provider"); khai `models` thì thay thế catalog của nhà cung cấp đó.

## (h) Quyết định: **dùng SDK trong tiến trình main** (không cần RPC tiến trình con, không cần giữ `chat.ts` làm đường chính)
Cơ sở [chạy]: SDK 1.5.2 chạy trong main của Electron 44.9.3 (Node 24.22.0 ≥ 22.19) cả bản dev lẫn bản đóng gói `file://`/asar, tool tùy biến, chặn `tool_call`, `text_delta`, nối system prompt, đăng ký provider OpenAI-compatible đều quan sát được; Monaco tô cú pháp `.ts`/`.py` và chạy worker TypeScript, cả dev và đóng gói.

Ràng buộc bắt buộc cho Task 4–7:
1. Nạp pi bằng `await import('@earendil-works/pi-coding-agent')` qua một module duy nhất; không `import` tĩnh trong `src/main` (CJS không `require` được, mục (a)).
2. Thêm `typebox@1.3.27` làm dependency trực tiếp; commit `allowBuilds: false` cho `@google/genai`, `protobufjs` trong `pnpm-workspace.yaml`.
3. `tools` là allowlist gồm cả tool tự đăng ký; chặn `edit`/`write` ngoài thư mục dự án và `bash` trong `tool_call` (mục (c), (d)); `path` chưa được chuẩn hóa nên phải `resolve` trước khi so.
4. Truyền `agentDir` và `authPath`/`modelsPath` riêng trong dữ liệu ứng dụng; không đọc `~/.pi`.
5. `monaco-editor` đặt `devDependencies` để không chép 100 MB vào asar (đề xuất, chưa đo).
6. Import Monaco theo `monaco-editor/editor/editor.api.js` và `…/languages/definitions/*/register.js`; worker bằng `?worker`.

**Chưa kiểm, phải xử lý trước khi coi là xong** (không làm đổi quyết định, nhưng có thể đổi chi tiết):
- Nhà cung cấp thật (xác thực, streaming thật, định dạng `edit` do model sinh); chưa có API key trong môi trường nên chỉ có máy chủ giả.
- Đăng nhập OAuth (cố ý không chạy), cầu nối `AuthInteraction` ↔ renderer.
- Windows: `bash`, `read` không cần Git, đường dẫn tiếng Việt, kích thước/khởi động trên Windows, Monaco worker qua `file://` trên Windows.
- Bộ cài (`.dmg`, NSIS) và kích thước nén; kích thước sau khi chuyển Monaco sang `devDependencies`.
- Kiểm bằng mắt giao diện Monaco, và hành vi trong cửa sổ có tương tác (focus, IME tiếng Việt).
- Thời gian khởi động của phiên pi trong main và RAM (không đo).
