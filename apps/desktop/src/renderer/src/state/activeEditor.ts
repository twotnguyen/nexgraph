import type { EditorHandle } from '../components/editor/monaco'

/** Thẻ tệp đang hiện và editor của nó (thẻ báo vào khi hiện), cho lệnh cần "tệp đang mở": chia sẻ cộng tác, lệnh chèn văn bản của extension. */
export type ActiveEditor = { file: string; handle: EditorHandle; text: () => string }
let active: ActiveEditor | null = null
export const setActiveEditor = (next: ActiveEditor | null): void => { active = next }
export const getActiveEditor = (): ActiveEditor | null => active
