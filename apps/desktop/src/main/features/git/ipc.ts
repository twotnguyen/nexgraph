import { shell } from 'electron'
import { gitCommitDiff, gitCommitFiles, gitHistory } from '../../git/history'
import { gitApplyHunk, gitHunks } from '../../git/hunks'
import { gitPermalink } from '../../git/permalink'
import { gitBlame, gitBranches, gitCommit, gitDiffSides, gitRemote, gitRestore, gitStage, gitStashAction, gitStashes, gitStashSave, gitStatus, gitSwitchBranch, gitUnstage } from '../../git/repo'
import { gitWorktreeAdd, gitWorktreeRemove, gitWorktrees } from '../../git/worktree'
import type { IpcContext } from '../../platform/ipc-context'

/** Source control trong gốc dự án. Viết thông điệp commit bằng AI nằm ở tính năng agent (`git:suggest-message`). */
export function registerGitIpc(ctx: IpcContext): void {
  const { on, rootOf } = ctx
  on('git:status', async (pid: string) => gitStatus(await rootOf(pid)))
  on('git:stage', async (pid: string, files: string[]) => gitStage(await rootOf(pid), files))
  on('git:unstage', async (pid: string, files: string[]) => gitUnstage(await rootOf(pid), files))
  on('git:commit', async (pid: string, message: string, amend: boolean, coAuthors?: string[]) => gitCommit(await rootOf(pid), message, amend === true, coAuthors ?? []))
  on('git:diff', async (pid: string, file: string, staged: boolean, base?: string) => gitDiffSides(await rootOf(pid), file, staged === true, base))
  on('git:blame', async (pid: string, file: string) => gitBlame(await rootOf(pid), file))
  on('git:restore', async (pid: string, file: string) => gitRestore(await rootOf(pid), file, (path) => shell.trashItem(path)))
  on('git:branches', async (pid: string) => gitBranches(await rootOf(pid)))
  on('git:switch-branch', async (pid: string, name: string, create: boolean) => gitSwitchBranch(await rootOf(pid), name, create === true))
  on('git:remote', async (pid: string, op: 'fetch' | 'pull' | 'push') => gitRemote(await rootOf(pid), op))
  on('git:history', async (pid: string, all: boolean) => gitHistory(await rootOf(pid), all === true))
  on('git:commit-files', async (pid: string, sha: string) => gitCommitFiles(await rootOf(pid), sha))
  on('git:commit-diff', async (pid: string, sha: string, file: string, from?: string) => gitCommitDiff(await rootOf(pid), sha, file, from))
  on('git:hunks', async (pid: string, file: string, staged: boolean) => gitHunks(await rootOf(pid), file, staged === true))
  on('git:apply-hunk', async (pid: string, file: string, staged: boolean, id: string) => gitApplyHunk(await rootOf(pid), file, staged === true, id))
  on('git:stashes', async (pid: string) => gitStashes(await rootOf(pid)))
  on('git:stash-save', async (pid: string, message: string) => gitStashSave(await rootOf(pid), message))
  on('git:stash-action', async (pid: string, ref: string, action: 'apply' | 'pop' | 'drop') => gitStashAction(await rootOf(pid), ref, action))
  on('git:worktrees', async (pid: string) => gitWorktrees(await rootOf(pid)))
  on('git:worktree-add', async (pid: string, branch: string, existing: boolean) => gitWorktreeAdd(await rootOf(pid), branch, existing === true))
  on('git:worktree-remove', async (pid: string, path: string) => gitWorktreeRemove(await rootOf(pid), path))
  on('git:permalink', async (pid: string, file: string, start?: number, end?: number, text?: string) => gitPermalink(await rootOf(pid), file, start, end, text))
}
