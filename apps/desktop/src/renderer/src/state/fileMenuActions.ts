/**
 * Menu File cần mở tệp/dự án theo đường dẫn cụ thể — lệnh registry chỉ nhận không đối số.
 * Module này là cầu nối nhỏ: App đăng ký mở dự án, WorkspaceScreen đăng ký mở tệp trong project.
 */
type Actions = {
  openFile?: (path: string, relative?: string) => void
  openProject?: (path: string) => void
}

let actions: Actions = {}

/** Gắn các hành động có ngữ cảnh; trả về hàm gỡ chỉ các khoá đã gắn. */
export function registerFileMenuActions(next: Actions): () => void {
  actions = { ...actions, ...next }
  return () => {
    for (const key of Object.keys(next) as (keyof Actions)[]) delete actions[key]
  }
}

export function openFileFromMenu(path: string, relative?: string): void {
  actions.openFile?.(path, relative)
}

export function openProjectFromMenu(path: string): void {
  actions.openProject?.(path)
}

export function hasFileOpener(): boolean {
  return !!actions.openFile
}
