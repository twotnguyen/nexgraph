import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import type { AgentMode, ApprovalDecision, ApprovalRequest } from '../../shared/agent-types'
import { resolveInside } from '../fs/project-fs'

export const APPROVAL_TIMEOUT_MS = 5 * 60_000

export interface ApprovalGate {
  check(toolName: string, input: unknown): Promise<ApprovalDecision>
  resolve(id: string, allow: boolean): void
  denyAll(reason: string): void
  pending(): number
}

export type ApprovalDeps = {
  root: string
  getMode(): AgentMode
  ask(req: ApprovalRequest): void
  preview(tool: 'edit' | 'write', input: unknown): Promise<{ path: string; before: string; after: string }>
}

const deny = (reason: string): ApprovalDecision => ({ allow: false, reason })
const OUTSIDE = deny('Đường dẫn nằm ngoài dự án')

const isUp = (rel: string) => rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)

/** true khi `p` (tương đối hoặc tuyệt đối) nằm trong root sau realpath; mọi lỗi đều coi là ngoài. */
function insideRoot(root: string, p: string): boolean {
  try {
    let rel = p
    if (isAbsolute(p)) {
      // SDK không chuẩn hoá path: tuyệt đối trong root thì đổi sang tương đối rồi để resolveInside kiểm symlink.
      const found = [root, realpathSync(root)].map((r) => relative(r, p)).find((r) => !isUp(r))
      if (found === undefined) return false
      rel = found
    }
    resolveInside(root, rel)
    return true
  } catch {
    return false
  }
}

export function createApprovalGate(deps: ApprovalDeps): ApprovalGate {
  const waiting = new Map<string, { settle(d: ApprovalDecision): void }>()
  let epoch = 0 // denyAll tăng epoch để huỷ các check đang chờ preview

  const settle = (id: string, d: ApprovalDecision) => waiting.get(id)?.settle(d)

  const wait = (req: ApprovalRequest): Promise<ApprovalDecision> =>
    new Promise((done) => {
      const timer = setTimeout(() => settle(req.id, deny('Hết thời gian chờ duyệt')), APPROVAL_TIMEOUT_MS)
      waiting.set(req.id, {
        settle: (d) => {
          clearTimeout(timer)
          waiting.delete(req.id)
          done(d)
        }
      })
      try {
        deps.ask(req)
      } catch {
        settle(req.id, deny('Không gửi được yêu cầu duyệt'))
      }
    })

  async function check(toolName: string, input: unknown): Promise<ApprovalDecision> {
    if (toolName !== 'edit' && toolName !== 'write' && toolName !== 'bash') return { allow: true }
    if (deps.getMode() !== 'edit') return deny('Chế độ Hỏi không cho phép sửa tệp hoặc chạy lệnh')
    const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const id = randomUUID()

    if (toolName === 'bash') {
      if (typeof obj.command !== 'string') return deny('Thiếu lệnh cần chạy')
      return wait({ id, tool: 'bash', command: obj.command })
    }

    if (typeof obj.path !== 'string') return deny('Thiếu đường dẫn tệp')
    if (!insideRoot(deps.root, obj.path)) return OUTSIDE
    const myEpoch = epoch
    let pv
    try {
      pv = await deps.preview(toolName, input)
    } catch {
      return deny('Không tạo được bản xem trước thay đổi')
    }
    if (myEpoch !== epoch) return deny('Đã dừng')
    return wait({ id, tool: toolName, path: pv.path, before: pv.before, after: pv.after })
  }

  return {
    check,
    resolve: (id, allow) => settle(id, allow ? { allow: true } : deny('Người dùng từ chối thao tác này')),
    denyAll(reason) {
      epoch++
      for (const id of [...waiting.keys()]) settle(id, deny(reason))
    },
    pending: () => waiting.size
  }
}
