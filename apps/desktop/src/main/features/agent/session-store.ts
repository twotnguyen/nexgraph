import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import type { SessionManager } from '@earendil-works/pi-coding-agent'
import type { AgentSessionInfo, AgentTask } from '@nexgraph/contracts/agent-types'
import { writeJson } from '../../platform/settings'

export type SessionScope = {
  projectId: string
  root: string
  provider: string
  baseUrl: string
  account: string
}

type SessionRecord = AgentSessionInfo & { file: string; task?: AgentTask }
type SessionIndex = { version: 1; scope: string; activeId: string | null; sessions: SessionRecord[] }
type SessionSdk = Pick<typeof import('@earendil-works/pi-coding-agent'), 'SessionManager'>
export type StoredSession = {
  scope: SessionScope
  directory: string
  record: SessionRecord
  manager: SessionManager
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

export function sessionScopeId(scope: SessionScope): string {
  return createHash('sha256').update(JSON.stringify([
    scope.projectId, scope.root, scope.provider, scope.baseUrl, scope.account
  ])).digest('hex')
}

/** Pi JSONL is the conversation source. This index stores names, active selection and task results. */
export class SessionStore {
  constructor(private readonly dataDir: string, private readonly sdk: () => Promise<SessionSdk>) {}

  directory(scope: SessionScope): string {
    return join(this.dataDir, 'agent', 'sessions', sessionScopeId(scope))
  }

  private index(scope: SessionScope): SessionIndex {
    const key = sessionScopeId(scope)
    let raw: string
    try { raw = readFileSync(join(this.directory(scope), 'index.json'), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, scope: key, activeId: null, sessions: [] }
      throw error
    }
    let value: SessionIndex
    try { value = JSON.parse(raw) as SessionIndex } catch {
      throw failure('session_corrupt', 'Danh sách hội thoại bị hỏng. Chưa thay đổi dữ liệu đã lưu.')
    }
    if (!value || typeof value !== 'object' || value.version !== 1 || value.scope !== key || !Array.isArray(value.sessions) ||
      (value.activeId !== null && (!ID.test(value.activeId) || !value.sessions.some((item) => item?.id === value.activeId))) ||
      new Set(value.sessions.map((item) => item?.id)).size !== value.sessions.length ||
      value.sessions.some((item) => !item || !ID.test(item.id) || typeof item.file !== 'string' || basename(item.file) !== item.file ||
        !item.file.endsWith(`_${item.id}.jsonl`) || typeof item.title !== 'string' || typeof item.createdAt !== 'number' ||
        !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt) || typeof item.model !== 'string' ||
        !Number.isSafeInteger(item.messageCount) || item.messageCount < 0 || item.provider !== scope.provider || item.baseUrl !== scope.baseUrl ||
        (item.task && (!ID.test(item.task.id) || item.task.sessionId !== item.id)))) {
      throw failure('session_corrupt', 'Hội thoại không khớp dự án hoặc tài khoản đang chọn.')
    }
    return value
  }

  private save(scope: SessionScope, index: SessionIndex): void {
    mkdirSync(this.directory(scope), { recursive: true, mode: 0o700 })
    writeJson(join(this.directory(scope), 'index.json'), index)
  }

  list(scope: SessionScope): AgentSessionInfo[] {
    return this.index(scope).sessions.map(({ file: _file, task: _task, ...info }) => info)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async open(scope: SessionScope, model: string, requestedId?: string, forceNew = false): Promise<StoredSession> {
    if (requestedId !== undefined && !ID.test(requestedId)) throw failure('bad_param', 'Mã hội thoại không hợp lệ')
    const index = this.index(scope)
    let record = forceNew ? undefined : index.sessions.find((item) => item.id === (requestedId ?? index.activeId))
    if (requestedId && !record) throw failure('session_not_found', 'Hội thoại không thuộc dự án và tài khoản đang chọn')
    const directory = this.directory(scope)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const { SessionManager } = await this.sdk()
    let manager: SessionManager
    if (record && existsSync(join(directory, record.file))) {
      const path = join(directory, record.file)
      const canonical = realpathSync.native(path)
      const inside = relative(realpathSync.native(directory), canonical)
      if (lstatSync(path).isSymbolicLink() || inside.startsWith('..' + sep) || inside === '..') {
        throw failure('session_corrupt', 'Đường dẫn hội thoại nằm ngoài kho dữ liệu')
      }
      let header: { type?: string; id?: string; cwd?: string }
      try { header = JSON.parse(readFileSync(path, 'utf8').split(/\r?\n/, 1)[0]) as typeof header } catch {
        throw failure('session_corrupt', 'Không đọc được bản ghi hội thoại')
      }
      if (!header || header.type !== 'session' || header.id !== record.id || header.cwd !== scope.root) {
        throw failure('session_corrupt', 'Hội thoại đã lưu không khớp gốc dự án')
      }
      manager = SessionManager.open(path, directory, scope.root)
    } else {
      if (record && record.messageCount > 0) throw failure('session_missing', 'Tệp hội thoại đã lưu bị thiếu')
      manager = SessionManager.create(scope.root, directory, { id: record?.id ?? randomUUID() })
      const now = Date.now()
      record = record ?? {
        id: manager.getSessionId(), title: 'Hội thoại mới', provider: scope.provider, baseUrl: scope.baseUrl,
        model, createdAt: now, updatedAt: now, messageCount: 0, file: basename(manager.getSessionFile()!)
      }
      record.file = basename(manager.getSessionFile()!)
      if (!index.sessions.some((item) => item.id === record!.id)) index.sessions.push(record)
    }
    if (record.task && (record.task.status === 'running' || record.task.status === 'waiting_approval')) {
      record.task = { ...record.task, status: 'cancelled', finishedAt: Date.now(), error: 'Ứng dụng đã đóng trước khi tác vụ hoàn tất' }
      const tasks = join(directory, 'tasks')
      mkdirSync(tasks, { recursive: true, mode: 0o700 })
      writeJson(join(tasks, `${record.task.id}.json`), record.task)
    }
    index.activeId = record.id
    this.save(scope, index)
    return { scope, directory, record, manager }
  }

  async fork(scope: SessionScope, model: string, sourceId: string): Promise<StoredSession> {
    const source = await this.open(scope, model, sourceId)
    const { SessionManager } = await this.sdk()
    const sourcePath = source.manager.getSessionFile()!
    const id = randomUUID()
    const manager = existsSync(sourcePath)
      ? SessionManager.forkFrom(sourcePath, scope.root, source.directory, { id })
      : SessionManager.create(scope.root, source.directory, { id })
    const sourceLeaf = source.manager.getLeafId()
    if (sourceLeaf && manager.getLeafId() !== sourceLeaf) {
      manager.branch(sourceLeaf)
      manager.appendCustomEntry('nexgraph_fork')
    }
    const now = Date.now()
    const record: SessionRecord = {
      id, title: source.record.title, provider: scope.provider, baseUrl: scope.baseUrl,
      model: source.record.model, createdAt: now, updatedAt: now,
      messageCount: manager.getBranch().filter((item) => item.type === 'message').length,
      file: basename(manager.getSessionFile() ?? `${new Date().toISOString().replace(/[:.]/g, '-')}_${id}.jsonl`)
    }
    const index = this.index(scope)
    index.sessions.push(record)
    index.activeId = id
    this.save(scope, index)
    return { scope, directory: source.directory, record, manager }
  }

  touch(session: StoredSession, model: string, firstPrompt?: string): void {
    const index = this.index(session.scope)
    const record = index.sessions.find((item) => item.id === session.record.id)
    if (!record) throw failure('session_not_found', 'Hội thoại đã bị xóa')
    if (record.messageCount === 0 && firstPrompt && record.title === 'Hội thoại mới') record.title = firstPrompt.replace(/\s+/g, ' ').slice(0, 72)
    record.messageCount = session.manager.getBranch().filter((item) => item.type === 'message').length
    record.model = model
    record.updatedAt = Date.now()
    if (session.record.task) record.task = session.record.task
    session.record = record
    index.activeId = record.id
    this.save(session.scope, index)
  }

  task(session: StoredSession, task: AgentTask): void {
    session.record.task = task
    const tasks = join(session.directory, 'tasks')
    mkdirSync(tasks, { recursive: true, mode: 0o700 })
    writeJson(join(tasks, `${task.id}.json`), task)
    this.touch(session, session.record.model)
  }

  recordRollback(scope: SessionScope, taskId: string, checkpointIds: string[]): AgentTask {
    if (!ID.test(taskId)) throw failure('bad_param', 'Mã tác vụ không hợp lệ')
    const index = this.index(scope)
    const file = join(this.directory(scope), 'tasks', taskId + '.json')
    const task = JSON.parse(readFileSync(file, 'utf8')) as AgentTask
    const record = index.sessions.find((item) => item.id === task.sessionId)
    if (!record || task.id !== taskId) throw failure('task_not_found', 'Tác vụ không thuộc kho hội thoại đang chọn')
    const updated = { ...task, checkpointIds }
    writeJson(file, updated)
    if (record.task?.id === taskId) {
      record.task = updated
      this.save(scope, index)
    }
    return updated
  }

  rename(scope: SessionScope, id: string, title: string): void {
    if (!ID.test(id) || typeof title !== 'string' || !title.trim() || title.length > 160) throw failure('bad_param', 'Tên hội thoại phải dài từ 1 đến 160 ký tự')
    const index = this.index(scope)
    const record = index.sessions.find((item) => item.id === id)
    if (!record) throw failure('session_not_found', 'Không tìm thấy hội thoại')
    record.title = title.trim()
    record.updatedAt = Date.now()
    this.save(scope, index)
  }

  remove(scope: SessionScope, id: string): void {
    if (!ID.test(id)) throw failure('bad_param', 'Mã hội thoại không hợp lệ')
    const index = this.index(scope)
    const record = index.sessions.find((item) => item.id === id)
    if (!record) throw failure('session_not_found', 'Không tìm thấy hội thoại')
    const path = join(this.directory(scope), record.file)
    if (existsSync(path)) unlinkSync(path)
    const tasks = join(this.directory(scope), 'tasks')
    for (const name of existsSync(tasks) ? readdirSync(tasks) : []) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue
      const taskFile = join(tasks, name)
      const task = JSON.parse(readFileSync(taskFile, 'utf8')) as AgentTask
      if (task.sessionId !== id || !ID.test(task.id)) continue
      const checkpoint = join(this.directory(scope), 'checkpoints', 'checkpoints',
        createHash('sha256').update(scope.root).digest('hex'), createHash('sha256').update(task.id).digest('hex') + '.json')
      if (existsSync(checkpoint)) unlinkSync(checkpoint)
      unlinkSync(taskFile)
    }
    index.sessions = index.sessions.filter((item) => item.id !== id)
    if (index.activeId === id) index.activeId = null
    this.save(scope, index)
  }
}
