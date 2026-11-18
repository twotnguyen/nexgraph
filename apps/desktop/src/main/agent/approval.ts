import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import type { AgentMode, ApprovalDecision, ApprovalRequest } from '../../shared/agent-types'
import type { FileContent } from '../../shared/api'
import { FsError, resolveInside } from '../fs/project-fs'

export const APPROVAL_TIMEOUT_MS = 5 * 60_000

/** Bản xem trước và phiên bản tệp tại cùng lần đọc. `file` vắng khi tạo tệp mới. */
export type WritePreview = {
  path: string
  before: string
  after: string
  file?: Pick<FileContent, 'eol' | 'bom' | 'version'>
}

export type ApprovedWrite = WritePreview & { assertCurrent(): void }

export interface ApprovalGate {
  check(toolName: string, input: unknown): Promise<ApprovalDecision & { approved?: ApprovedWrite }>
  resolve(id: string, allow: boolean): void
  denyAll(reason: string): void
  pending(): number
}

export type ApprovalDeps = {
  root: string
  getMode(): AgentMode
  ask(req: ApprovalRequest): void
  preview(tool: 'edit' | 'write', input: unknown): Promise<WritePreview>
  /** Gọi khi một yêu cầu đã hỏi được giải quyết (duyệt, từ chối, hết giờ, denyAll). */
  closed?(id: string): void
}

const deny = (reason: string): ApprovalDecision => ({ allow: false, reason })
const OUTSIDE = deny('Đường dẫn nằm ngoài dự án')

/** Chuẩn hóa đầu vào của Pi trước khi chuyển cho resolveInside kiểm tra đích thật. */
export function toProjectRelative(root: string, path: string): string {
  if (!isAbsolute(path)) return path
  // Dùng cùng realpath với resolveInside, kể cả khi Windows trả về gốc dạng 8.3.
  for (const base of [root, realpathSync.native(root)]) {
    const rel = relative(base, path)
    if (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) return rel
  }
  throw new FsError('outside_project', `Đường dẫn nằm ngoài dự án: ${path}`)
}

/** true khi `p` (tương đối hoặc tuyệt đối) nằm trong root sau realpath; mọi lỗi đều coi là ngoài. */
function insideRoot(root: string, p: string): boolean {
  try {
    resolveInside(root, toProjectRelative(root, p))
    return true
  } catch {
    return false
  }
}

export function createApprovalGate(deps: ApprovalDeps): ApprovalGate {
  const waiting = new Map<string, { settle(d: ApprovalDecision): void }>()
  let epoch = 0
  let revokedReason = 'Đã dừng'

  const settle = (id: string, d: ApprovalDecision) => waiting.get(id)?.settle(d)

  const wait = (req: ApprovalRequest): Promise<ApprovalDecision> =>
    new Promise((done) => {
      const timer = setTimeout(() => settle(req.id, deny('Hết thời gian chờ duyệt')), APPROVAL_TIMEOUT_MS)
      waiting.set(req.id, {
        settle: (d) => {
          clearTimeout(timer)
          waiting.delete(req.id)
          done(d)
          deps.closed?.(req.id)
        }
      })
      try {
        deps.ask(req)
      } catch {
        settle(req.id, deny('Không gửi được yêu cầu duyệt'))
      }
    })

  async function check(toolName: string, input: unknown): Promise<ApprovalDecision & { approved?: ApprovedWrite }> {
    if (toolName !== 'edit' && toolName !== 'write') return deny('Chỉ có thể duyệt thao tác sửa tệp')
    if (deps.getMode() !== 'edit') return deny('Chế độ Hỏi chỉ cho phép đọc')
    const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    if (typeof obj.path !== 'string') return deny('Thiếu đường dẫn tệp')
    if (!insideRoot(deps.root, obj.path)) return OUTSIDE
    const myEpoch = epoch
    let preview: WritePreview
    try {
      preview = await deps.preview(toolName, input)
    } catch {
      return deny('Không tạo được bản xem trước thay đổi')
    }
    if (myEpoch !== epoch) return deny(revokedReason)
    const decision = await wait({ id: randomUUID(), tool: toolName, path: preview.path, before: preview.before, after: preview.after })
    if (!decision.allow) return decision
    if (myEpoch !== epoch) return deny(revokedReason)
    const assertCurrent = () => {
      if (myEpoch !== epoch) throw new Error(revokedReason)
    }
    return { ...decision, approved: { ...preview, assertCurrent } }
  }

  return {
    check,
    resolve: (id, allow) => settle(id, allow ? { allow: true } : deny('Người dùng từ chối thao tác này')),
    denyAll(reason) {
      revokedReason = reason
      epoch++
      for (const id of [...waiting.keys()]) settle(id, deny(reason))
    },
    pending: () => waiting.size
  }
}
