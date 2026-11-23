import { tr } from '../strings'

/**
 * Chuỗi giao diện giữ trong state phải dịch lúc render: đổi ngôn ngữ khi pane còn sống
 * vẫn đổi nhãn (F5, MIN-45b). State giữ khoá + dữ liệu, không giữ câu đã dịch.
 */
export interface Msg {
  key: string
  vars?: Record<string, string | number>
}

/** `string` là câu động (engine, lỗi hệ thống) — giữ nguyên; `Msg` dịch theo ngôn ngữ hiện tại. */
export type Message = string | Msg

export const msg = (key: string, vars?: Record<string, string | number>): Msg => (vars ? { key, vars } : { key })

/** Câu hiển thị của một Message; `null`/rỗng thành chuỗi rỗng. */
export function msgText(message: Message | null | undefined): string {
  if (message == null) return ''
  return typeof message === 'string' ? message : tr(message.key, message.vars)
}
