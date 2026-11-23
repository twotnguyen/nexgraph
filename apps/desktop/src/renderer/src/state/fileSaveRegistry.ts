/** Thao tác lưu do mỗi thẻ tệp đăng ký để chạy lệnh Lưu tất cả / Lưu thành mà không giữ component trong state. */
type FileSaver = { save: () => Promise<boolean>; saveAs: () => Promise<void>; revert?: () => Promise<boolean> }

const savers = new Map<string, FileSaver>()
const key = (projectId: string, file: string) => `${projectId}\0${file}`

export function registerFileSaver(projectId: string, file: string, saver: FileSaver): () => void {
  const id = key(projectId, file)
  savers.set(id, saver)
  return () => { if (savers.get(id) === saver) savers.delete(id) }
}

export function getFileSaver(projectId: string, file: string): FileSaver | undefined {
  return savers.get(key(projectId, file))
}

/** Lưu lần lượt từng tệp; trả về danh sách tệp lỗi để báo riêng mà không bỏ qua các tệp còn lại. */
export async function saveAllFiles(projectId: string, files: readonly string[]): Promise<string[]> {
  const failed: string[] = []
  for (const file of files) {
    const saver = savers.get(key(projectId, file))
    try {
      if (!saver || !(await saver.save())) failed.push(file)
    } catch { failed.push(file) }
  }
  return failed
}
