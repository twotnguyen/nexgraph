import { tr } from '../strings'

/**
 * Chuỗi giao diện giữ trong state phải dịch lúc render: đổi ngôn ngữ khi pane còn sống
 * vẫn đổi nhãn (F5, MIN-45b). State giữ khoá + dữ liệu, không giữ câu đã dịch.
 */
export interface Msg {
  key: string
  /** Biến có thể là `Message` khác: câu lỗi lồng nhau vẫn dịch lúc render, không chốt lúc gọi. */
  vars?: Record<string, MessageVar>
}

export type MessageVar = string | number | Message

/** `string` là câu động (engine, lỗi hệ thống) — giữ nguyên; `Msg` dịch theo ngôn ngữ hiện tại. */
export type Message = string | Msg

export const msg = (key: string, vars?: Record<string, MessageVar>): Msg => (vars ? { key, vars } : { key })

/** Lỗi mang khoá thông điệp: `throw msgError('…')` thay vì ném Error với chuỗi `vi.*` đã dịch, để chỗ bắt dịch lúc render. */
export class MsgError extends Error {
  readonly msg: Msg
  constructor(key: string, vars?: Record<string, string | number>) {
    super(key)
    this.name = 'MsgError'
    this.msg = msg(key, vars)
  }
}

export const msgError = (key: string, vars?: Record<string, string | number>): MsgError => new MsgError(key, vars)

/** Câu hiển thị của một Message; `null`/rỗng thành chuỗi rỗng. */
export function msgText(message: Message | null | undefined): string {
  if (message == null) return ''
  if (typeof message === 'string') return message
  if (!message.vars) return tr(message.key)
  const vars: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(message.vars)) vars[name] = typeof value === 'object' ? msgText(value) : value
  return tr(message.key, vars)
}

/**
 * Dấu nhận dạng không phụ thuộc ngôn ngữ, dùng để so và thu hồi thông báo:
 * `msgText` đổi theo ngôn ngữ nên so bằng chuỗi sẽ trượt khi người dùng đổi ngôn ngữ.
 */
export function msgId(message: Message | null | undefined): string | null {
  if (message == null) return null
  if (typeof message === 'string') return message
  return `${message.key}|${JSON.stringify(message.vars ?? {})}`
}
