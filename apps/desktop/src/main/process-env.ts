/**
 * Môi trường tối thiểu cho tiến trình con của app (git, LSP, debug adapter, lệnh agent).
 *
 * App desktop được mở từ shell của người dùng, nên `process.env` có thể chứa credential
 * (AWS_*, GH_TOKEN, NPM_TOKEN, OPENAI_API_KEY, SSH_AUTH_SOCK…) và cấu hình Python của
 * tiến trình cha (PYTHONPATH/PYTHONHOME làm engine/venv chết ở import). Chỉ chuyển tiếp
 * danh sách biến hệ thống dưới đây; mọi thứ khác bị bỏ, trừ `extra` do mã nội bộ đặt.
 */
const SAFE_ENV_KEYS: ReadonlySet<string> = new Set([
  // Đường dẫn và thư mục người dùng
  'path', 'pathext', 'home', 'userprofile', 'homedrive', 'homepath', 'systemdrive',
  'temp', 'tmp', 'tmpdir', 'appdata', 'localappdata', 'programdata', 'programfiles',
  'programfiles(x86)', 'commonprogramfiles', 'commonprogramfiles(x86)', 'allusersprofile', 'public',
  // Windows
  'systemroot', 'windir', 'comspec', 'username', 'userdomain', 'userdomain_roamingprofile', 'logonserver',
  'psmodulepath',
  // Shell và locale trên macOS/Linux
  'shell', 'user', 'logname', 'lang', 'lc_all', 'lc_ctype', 'languagelist', 'term', 'colorterm',
  'display', 'wayland_display', 'xdg_runtime_dir', 'xdg_session_type', 'dbus_session_bus_address',
  // Máy
  'number_of_processors', 'processor_architecture', 'processor_identifier', 'os',
  // Proxy và CA (mạng nội bộ của người dùng)
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'ssl_cert_file', 'ssl_cert_dir', 'node_extra_ca_certs'
])

/** Sao chép các biến hệ thống cần thiết; `extra` (do mã NexGraph đặt) được ghi đè sau cùng. */
export function safeProcessEnv(source: NodeJS.ProcessEnv = process.env, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && SAFE_ENV_KEYS.has(key.toLowerCase())) env[key] = value
  }
  return { ...env, ...extra }
}

/**
 * Terminal tích hợp là shell của chính người dùng: giữ env người dùng (aws/gh/npm CLI của họ cần
 * AWS_PROFILE, GH_TOKEN…), chỉ bỏ token nội bộ của NexGraph nếu có trong môi trường.
 */
export function userShellEnv(source: NodeJS.ProcessEnv = process.env, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source, ...extra }
  delete env.NEXGRAPH_TOKEN
  return env
}
