// Thư mục mà thay đổi bên trong không bao giờ cần lập chỉ mục lại (khớp SKIP_DIRS của engine, cộng thư mục công cụ).
const IGNORED_DIRS = new Set(['.nexgraph', 'build', '.dart_tool', 'node_modules', '.idea', 'ephemeral'])

// Tệp tạm `.<tên>.<uuid>.tmp` mà fs.write tạo cạnh đích rồi đổi tên; chỉ lần đổi tên mới là thay đổi thật.
const WRITE_TMP = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i

/** `relPath` tương đối với gốc project, dùng `/` hoặc `\`. */
export function shouldIgnore(relPath: string): boolean {
  const parts = relPath.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.')
  const gitAt = parts.indexOf('.git')
  if (gitAt >= 0) {
    // Trong .git chỉ HEAD (đổi nhánh/commit) và refs/** (nhánh, tag) làm đổi kết quả `git diff HEAD`.
    const rest = parts.slice(gitAt + 1)
    return !((rest.length === 1 && rest[0] === 'HEAD') || rest[0] === 'refs')
  }
  if (parts.length && WRITE_TMP.test(parts[parts.length - 1])) return true
  return parts.some((p) => IGNORED_DIRS.has(p))
}
