import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileContent, FileRevision } from '../../shared/api'
import { deleteProjectFile, FsError, readProjectFile, writeProjectFile } from '../fs/project-fs'
import type { WritePreview } from './approval'

export type CheckpointFile = {
  id: string
  path: string
  before: string
  after: string
  created: boolean
  state: 'applied' | 'pending' | 'restored'
  createdAt: number
  restored?: boolean
  deleted?: boolean
}
type RecordFile = CheckpointFile & {
  eol: '\n' | '\r\n'
  bom: boolean
  afterVersion?: string | null
}
type Snapshot = { version: 1; root: string; taskId: string; files: RecordFile[]; command?: { before: [string, FileContent][]; existingPaths: string[] } }
export type RollbackResult = { restored: string[]; conflicts: { path: string; reason: string }[] }

/** Checkpoint thuộc một tác vụ, ghi riêng trong userData và khôi phục có đối chiếu phiên bản. */
export class CheckpointStore {
  private readonly file: string
  private readonly root: string
  private snapshot: Snapshot
  private queue: Promise<unknown> = Promise.resolve()

  constructor(root: string, storageDir: string, taskId: string, private readonly assertEditable?: (path: string) => void) {
    this.root = realpathSync.native(root)
    const project = createHash('sha256').update(this.root).digest('hex')
    const id = createHash('sha256').update(taskId).digest('hex')
    const directory = join(storageDir, 'checkpoints', project)
    mkdirSync(directory, { recursive: true })
    this.file = join(directory, id + '.json')
    this.snapshot = { version: 1, root: this.root, taskId, files: [] }
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8')) as Snapshot
      if (value.version !== 1 || value.root !== this.root || value.taskId !== taskId || !Array.isArray(value.files)) throw new Error('Checkpoint không hợp lệ')
      this.snapshot = value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  list(): CheckpointFile[] {
    return this.snapshot.files.map(({ id, path, before, after, created, deleted, state, createdAt }) => ({
      id, path, before, after, created, deleted, state, createdAt, restored: state === 'restored'
    }))
  }

  private save(): void {
    const temporary = this.file + '.' + randomUUID() + '.tmp'
    writeFileSync(temporary, JSON.stringify(this.snapshot), { mode: 0o600 })
    renameSync(temporary, this.file)
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => {})
    return run
  }

  write(preview: WritePreview, assertCurrent: () => void): Promise<FileRevision> {
    return this.enqueue(async () => {
      assertCurrent()
      this.assertEditable?.(preview.path)
      const previous = this.snapshot.files.find((f) => f.path === preview.path && f.state !== 'restored')
      if (previous && (previous.state !== 'applied' || previous.afterVersion !== (preview.file?.version ?? null))) {
        throw new FsError('conflict', 'Tệp đã thay đổi sau checkpoint. Giữ thay đổi của người dùng và đọc lại tác vụ.')
      }
      const record: RecordFile = {
        id: previous?.id ?? createHash('sha256').update(this.snapshot.taskId + '\0' + preview.path).digest('hex'),
        path: preview.path, before: previous?.before ?? preview.before, after: preview.after,
        created: previous?.created ?? !preview.file, eol: previous?.eol ?? preview.file?.eol ?? '\n',
        bom: previous?.bom ?? preview.file?.bom ?? false, state: 'pending', createdAt: previous?.createdAt ?? Date.now()
      }
      const original = [...this.snapshot.files]
      this.snapshot.files = [...original.filter((f) => f.path !== preview.path), record]
      this.save()
      let revision: FileRevision
      try {
        revision = await writeProjectFile(this.root, preview.path, preview.after, {
          eol: record.eol, bom: record.bom, expectedVersion: preview.file?.version ?? null
        }, { assertNotCancelled: assertCurrent })
      } catch (error) {
        this.snapshot.files = original
        this.save()
        throw error
      }
      record.afterVersion = revision.version
      record.state = 'applied'
      // Nếu ghi checkpoint lỗi sau khi công bố tệp, bản pending trên đĩa ngăn hoàn tác không chắc chắn.
      this.save()
      return revision
    })
  }

  /** Lưu bản trước lệnh để khôi phục thủ công được nếu ứng dụng bị dừng giữa lệnh. */
  beginCommand(files: Map<string, FileContent>, existingPaths = new Set(files.keys())): Promise<void> {
    return this.enqueue(async () => {
      if (this.snapshot.command) throw new Error('Lệnh trước chưa đối chiếu checkpoint, hãy kiểm lại phiên trước khi chạy tiếp')
      for (const record of this.snapshot.files) {
        if (record.state !== 'applied') continue
        if ((files.get(record.path)?.version ?? null) !== record.afterVersion) {
          throw new FsError('conflict', 'Tệp đã thay đổi sau tác vụ AI, giữ thay đổi hiện tại trước khi chạy lệnh')
        }
      }
      this.snapshot.command = { before: [...files], existingPaths: [...existingPaths] }
      this.save()
    })
  }

  finishCommand(files: Map<string, FileContent>, existingPaths = new Set(files.keys())): Promise<string[]> {
    return this.enqueue(async () => {
      if (!this.snapshot.command) throw new Error('Thiếu checkpoint trước khi chạy lệnh')
      const before = new Map(this.snapshot.command.before)
      const existed = new Set(this.snapshot.command.existingPaths)
      const paths = new Set([...before.keys(), ...files.keys()])
      const changed: string[] = []
      for (const path of paths) {
        const old = before.get(path)
        const after = files.get(path)
        // Không coi tệp có trước nhưng chưa đọc được như một tệp mới có thể xoá khi hoàn tác.
        if ((!old && existed.has(path)) || (!after && existingPaths.has(path))) continue
        if (old?.version === after?.version) continue
        const previous = this.snapshot.files.find((file) => file.path === path && file.state !== 'restored')
        if (!previous && old && after && old.text === after.text && old.eol === after.eol && old.bom === after.bom) continue
        const record: RecordFile = {
          id: previous?.id ?? createHash('sha256').update(this.snapshot.taskId + '\0' + path).digest('hex'),
          path, before: previous?.before ?? old?.text ?? '', after: after?.text ?? '',
          created: previous?.created ?? !old, deleted: !after,
          eol: previous?.eol ?? old?.eol ?? after?.eol ?? '\n', bom: previous?.bom ?? old?.bom ?? after?.bom ?? false,
          afterVersion: after?.version ?? null, state: 'applied', createdAt: previous?.createdAt ?? Date.now()
        }
        this.snapshot.files = [...this.snapshot.files.filter((file) => file.path !== path), record]
        changed.push(path)
      }
      delete this.snapshot.command
      this.save()
      return changed
    })
  }

  rollback(): Promise<RollbackResult> {
    return this.enqueue(async () => {
      const result: RollbackResult = { restored: [], conflicts: [] }
      if (this.snapshot.command) {
        result.conflicts.push({ path: '.', reason: 'Có lệnh chưa đối chiếu sau khi dừng ứng dụng. Bản trước lệnh được giữ trong checkpoint, cần kiểm tra bằng tay.' })
        return result
      }
      for (const record of [...this.snapshot.files].reverse()) {
        if (record.state === 'restored') continue
        try {
          this.assertEditable?.(record.path)
          if (record.state !== 'applied' || record.afterVersion === undefined) throw new Error('Checkpoint chưa xác nhận đã ghi, cần đối chiếu tệp bằng tay')
          if (record.deleted) {
            if (record.created) {
              try { await readProjectFile(this.root, record.path); throw new Error('Tệp được tạo lại sau tác vụ') }
              catch (error) { if (!(error instanceof FsError && error.code === 'file_not_found')) throw error }
            } else await writeProjectFile(this.root, record.path, record.before, {
              eol: record.eol, bom: record.bom, expectedVersion: null
            }, { assertNotCancelled: () => this.assertEditable?.(record.path) })
            record.state = 'restored'
            this.save()
            result.restored.push(record.path)
            continue
          }
          const current = await readProjectFile(this.root, record.path)
          if (current.version !== record.afterVersion) throw new Error('Tệp đã được sửa sau tác vụ. Giữ nguyên thay đổi hiện tại.')
          if (record.created) await deleteProjectFile(this.root, record.path, record.afterVersion, () => this.assertEditable?.(record.path))
          else await writeProjectFile(this.root, record.path, record.before, {
            eol: record.eol, bom: record.bom, expectedVersion: record.afterVersion
          }, { assertNotCancelled: () => this.assertEditable?.(record.path) })
          record.state = 'restored'
          this.save()
          result.restored.push(record.path)
        } catch (error) {
          result.conflicts.push({ path: record.path, reason: error instanceof Error ? error.message : String(error) })
        }
      }
      return result
    })
  }
}
