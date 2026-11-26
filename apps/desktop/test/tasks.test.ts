import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureTasksFile, listTasks, parseJsonc, resolveTask } from '../src/main/features/terminal/tasks'
import { UserError } from '../src/main/platform/user-error'
import type { TaskDefinition } from '../src/shared/api'

let base: string
let root: string
let outside: string

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'ng-tasks-')))
  root = join(base, 'project')
  outside = join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

function config(source: '.nexgraph' | '.vscode', contents: string) {
  mkdirSync(join(root, source), { recursive: true })
  writeFileSync(join(root, source, 'tasks.json'), contents)
}

describe('project tasks', () => {
  it('ignores absent task files', async () => {
    expect(await listTasks(root)).toEqual([])
    mkdirSync(join(root, '.nexgraph'))
    expect(await listTasks(root)).toEqual([])
    expect(resolveTask(root, { label: 'ok', command: 'echo' }, {})).toEqual({ label: 'ok', command: 'echo' })
  })

  it('reads JSONC from both sources without damaging strings and maps VS Code options', async () => {
    config('.nexgraph', String.raw`[
      // The URL, escaped quotes and comment markers below are string contents.
      {"label":"HTTP", "command":"curl", "args":["https://example.test/a//b", "quote: \" and \\ slash", "/* text */",],},
      /* comment containing ] and , */
      {"label":"build", "command":"make",},
    ]`)
    config('.vscode', `{
      "version": "2.0.0",
      "tasks": [
        {"label":"Run", "command":"node", "type":"process", "args":["main.js",],
         "options":{"cwd":"\${workspaceFolder}/src", "env":{"NODE_ENV":"test"}}, "problemMatcher":"$tsc"},
        {"label":"Direct options", "command":"echo", "type":"shell", "cwd":"direct", "env":{"A":"direct"},
         "options":{"cwd":"ignored", "env":{"A":"ignored"}}},
      ],
    }`)
    expect(await listTasks(root)).toEqual([
      { label: 'HTTP', command: 'curl', args: ['https://example.test/a//b', 'quote: " and \\ slash', '/* text */'] },
      { label: 'build', command: 'make' },
      { label: 'Run', command: 'node', type: 'process', args: ['main.js'], cwd: '${workspaceFolder}/src', env: { NODE_ENV: 'test' } },
      { label: 'Direct options', command: 'echo', type: 'shell', cwd: 'direct', env: { A: 'direct' } }
    ])
  })

  it('accepts a NexGraph object and skips unsupported or malformed task entries', async () => {
    config('.nexgraph', JSON.stringify({ tasks: [
      { label: 'ok', command: 'echo', args: ['x'], type: 'shell' },
      { label: 'extension task', command: 'x', type: 'npm' },
      { label: 'bad args', command: 'x', args: ['ok', 1] },
      { label: 'bad cwd', command: 'x', cwd: false },
      { label: 'bad env', command: 'x', options: { env: { VAR: null } } },
      { label: 'bad options', command: 'x', options: [] },
      { label: '', command: 'x' }, { label: 'missing command' }, null, [], 1
    ] }))
    expect(await listTasks(root)).toEqual([{ label: 'ok', command: 'echo', args: ['x'], type: 'shell' }])
  })

  it.each([
    ['.nexgraph', '[{"label":"bad",}] /* unterminated'],
    ['.nexgraph', '[,]'],
    ['.nexgraph', '[true,,]'],
    ['.nexgraph', '[\"comment separator\" /* boundary */ \"missing comma\"]'],
    ['.vscode', '{"tasks":[{"label":"x","command":}]}'],
    ['.vscode', '[{"label":"x","command":"x"}]']
  ] as const)('reports malformed %s configuration without leaking its contents', async (source, contents) => {
    config(source, contents)
    try {
      await listTasks(root)
      throw new Error('expected an invalid configuration error')
    } catch (error) {
      expect(error).toBeInstanceOf(UserError)
      expect((error as Error).message).toContain(`${source}/tasks.json`)
      expect((error as Error).message).not.toContain(contents)
    }
  })

  it.skipIf(process.platform === 'win32')('rejects task file and directory symlinks escaping the project', async () => {
    writeFileSync(join(outside, 'tasks.json'), '[{"label":"outside","command":"echo"}]')
    for (const source of ['.nexgraph', '.vscode'] as const) {
      mkdirSync(join(root, source))
      symlinkSync(join(outside, 'tasks.json'), join(root, source, 'tasks.json'))
      await expect(listTasks(root)).rejects.toMatchObject({ code: 'outside_project' })
      rmSync(join(root, source), { recursive: true })
      symlinkSync(outside, join(root, source), 'dir')
      await expect(listTasks(root)).rejects.toMatchObject({ code: 'outside_project' })
      rmSync(join(root, source))
      symlinkSync(join(outside, 'missing-dir'), join(root, source), 'dir')
      await expect(listTasks(root)).rejects.toMatchObject({ code: 'outside_project' })
      rmSync(join(root, source))
    }
  })

  it.skipIf(process.platform === 'win32')('accepts in-project task symlinks but not protected targets', async () => {
    writeFileSync(join(root, 'shared-tasks.json'), '[{"label":"inside","command":"echo"}]')
    mkdirSync(join(root, '.nexgraph'))
    symlinkSync(join(root, 'shared-tasks.json'), join(root, '.nexgraph', 'tasks.json'))
    expect(await listTasks(root)).toEqual([{ label: 'inside', command: 'echo' }])
    rmSync(join(root, '.nexgraph', 'tasks.json'))
    writeFileSync(join(root, '.env'), '[{"label":"secret","command":"echo"}]')
    symlinkSync(join(root, '.env'), join(root, '.nexgraph', 'tasks.json'))
    await expect(listTasks(root)).rejects.toMatchObject({ code: 'protected_path' })
    rmSync(join(root, '.nexgraph', 'tasks.json'))
    symlinkSync(join(outside, 'missing.json'), join(root, '.nexgraph', 'tasks.json'))
    await expect(listTasks(root)).rejects.toMatchObject({ code: 'outside_project' })
  })

  it('expands file and line variables in every supported field without mutating the task', () => {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'hello.ts'), '')
    const task: TaskDefinition = {
      label: '${fileBasename} $ZED_FILENAME', command: '${workspaceFolder}',
      args: ['${file}', '${relativeFile}', '${fileDirname}', '${lineNumber}', '$ZED_FILE',
        '$ZED_RELATIVE_FILE', '$ZED_DIRNAME', '$ZED_ROW', '$ZED_WORKTREE_ROOT', '$HOME', '${unknown}', '$ZED_FILENAME_SUFFIX'],
      cwd: '${workspaceFolder}', env: { FILE: '${file}', ROW: '$ZED_ROW', KEEP: '$PATH' }, type: 'process'
    }
    expect(resolveTask(root, task, { file: 'src/hello.ts', line: 42 })).toEqual({
      label: 'hello.ts hello.ts', command: root,
      args: [join(root, 'src', 'hello.ts'), join('src', 'hello.ts'), join(root, 'src'), '42',
        join(root, 'src', 'hello.ts'), join('src', 'hello.ts'), join(root, 'src'), '42', root, '$HOME', '${unknown}', '$ZED_FILENAME_SUFFIX'],
      cwd: root, env: { FILE: join(root, 'src', 'hello.ts'), ROW: '42', KEEP: '$PATH' }, type: 'process'
    })
    expect(task.command).toBe('${workspaceFolder}')
    expect(task.env?.FILE).toBe('${file}')
    expect(resolveTask(root, task, { file: join(root, 'src', 'hello.ts'), line: 42 }).args?.[0]).toBe(join(root, 'src', 'hello.ts'))
    const absolute = join(root, 'src', 'hello.ts')
    // Quyết định lead (review #47 I1/I3): biến trong `command` chèn nguyên văn như VS Code; `args` để nguyên vì shellTask tự quote từng arg.
    expect(resolveTask(root, { label: 'x', command: '${file}' }, { file: absolute, line: 42 }).command).toBe(absolute)
  })

  it.runIf(process.platform !== 'win32')('MIN-38b M1 (quyết định lead): echo "${file}" in đường dẫn sạch, không thêm nháy', () => {
    const file = join(root, 'src', 'hello.ts')
    const resolved = resolveTask(root, { label: 'x', command: 'echo "${file}"' }, { file })
    expect(resolved.command).toBe(`echo "${file}"`)
    expect(execFileSync('/bin/sh', ['-c', resolved.command], { cwd: root, encoding: 'utf8' }).trim()).toBe(file)
    // Người dùng đã tự đặt ngoặc đơn: giữ nguyên, không thành ''/path''.
    const single = resolveTask(root, { label: 'x', command: "printf '%s' '${file}'" }, { file })
    expect(execFileSync('/bin/sh', ['-c', single.command], { cwd: root, encoding: 'utf8' })).toBe(file)
  })

  it.runIf(process.platform !== 'win32')('MIN-38b M1 (quyết định lead): --goto "${file}:${lineNumber}" ghép đúng như VS Code', () => {
    const resolved = resolveTask(root, { label: 'x', command: 'code --goto "${file}:${lineNumber}"' }, { file: 'src/a.ts', line: 7 })
    expect(resolved.command).toBe(`code --goto "${join(root, 'src', 'a.ts')}:7"`)
    const multi = resolveTask(root, { label: 'x', command: 'echo "line ${lineNumber}: ${file}"' }, { file: 'src/a.ts', line: 7 })
    expect(multi.command).toBe(`echo "line 7: ${join(root, 'src', 'a.ts')}"`)
  })

  it.runIf(process.platform !== 'win32')('MIN-38b M1 (quyết định lead): echo ${file} chèn nguyên văn, giống VS Code', () => {
    const resolved = resolveTask(root, { label: 'x', command: 'echo ${file}' }, { file: 'a;touch pwned;' })
    expect(resolved.command).toBe(`echo ${join(root, 'a;touch pwned;')}`)
  })

  it.runIf(process.platform !== 'win32')('MIN-38b M1: task type process giữ command là chương trình, không quote', () => {
    const resolved = resolveTask(root, { label: 'x', command: '${file}', type: 'process' }, { file: 'a;touch pwned;' })
    expect(resolved.command).toBe(join(root, 'a;touch pwned;'))
  })

  it('expands braced Zed variables and rejects missing context by name', () => {
    const task: TaskDefinition = { label: 'x', command: 'echo', args: [
      '${ZED_WORKTREE_ROOT}', '${ZED_FILE}', '${ZED_RELATIVE_FILE}', '${ZED_FILENAME}', '${ZED_DIRNAME}', '${ZED_ROW}'
    ] }
    expect(resolveTask(root, task, { file: 'src/a.ts', line: 7 }).args).toEqual([
      root, join(root, 'src', 'a.ts'), join('src', 'a.ts'), 'a.ts', join(root, 'src'), '7'
    ])
    expect(() => resolveTask(root, task, {})).toThrow('${ZED_FILE}')
  })

  it('reports missing context for each recognized variable without treating unknown variables as errors', () => {
    for (const variable of ['${file}', '${relativeFile}', '${fileBasename}', '${fileDirname}', '${lineNumber}',
      '$ZED_FILE', '$ZED_RELATIVE_FILE', '$ZED_FILENAME', '$ZED_DIRNAME', '$ZED_ROW']) {
      const task: TaskDefinition = { label: 'x', command: 'echo', args: [variable] }
      expect(() => resolveTask(root, task, {})).toThrow(UserError)
      expect(() => resolveTask(root, task, {})).toThrow(variable)
    }
    const task: TaskDefinition = {
      label: '${unknown}', command: '$SHELL', args: ['$ZED_WORKTREE_ROOT', '${lineNumber}', '$ZED_ROW', '$ZED_FILE_SUFFIX']
    }
    expect(resolveTask(root, task, { line: 3 })).toEqual({
      label: '${unknown}', command: '$SHELL', args: [root, '3', '3', '$ZED_FILE_SUFFIX']
    })
  })

  it('rejects file context that traverses or links outside the project', () => {
    const task: TaskDefinition = { label: 'x', command: '${file}' }
    for (const file of ['../outside/file.ts', join(outside, 'file.ts')])
      expect(() => resolveTask(root, task, { file })).toThrow(expect.objectContaining({ code: 'outside_project' }))
    if (process.platform !== 'win32') {
      symlinkSync(outside, join(root, 'link'), 'dir')
      expect(() => resolveTask(root, task, { file: 'link/file.ts' })).toThrow(expect.objectContaining({ code: 'outside_project' }))
    }
  })
})

describe('tệp cấu hình task', () => {
  it('tạo tasks.json mẫu và không ghi đè nội dung có sẵn', async () => {
    expect(await ensureTasksFile(root)).toBe('.vscode/tasks.json')
    const path = join(root, '.vscode', 'tasks.json')
    expect(parseJsonc(readFileSync(path, 'utf8'))).toMatchObject({ version: '2.0.0', tasks: [] })
    await expect(listTasks(root)).resolves.toEqual([])

    const custom = '// của người dùng\n{ "version": "2.0.0", "tasks": [] }'
    writeFileSync(path, custom)
    expect(await ensureTasksFile(root)).toBe('.vscode/tasks.json')
    expect(readFileSync(path, 'utf8')).toBe(custom)
  })

  it('luôn trả .vscode/tasks.json, kể cả khi chỉ có .nexgraph/tasks.json', async () => {
    config('.nexgraph', '{ "version": "2.0.0", "tasks": [] }')
    expect(await ensureTasksFile(root)).toBe('.vscode/tasks.json')
    expect(parseJsonc(readFileSync(join(root, '.vscode', 'tasks.json'), 'utf8'))).toMatchObject({ version: '2.0.0', tasks: [] })
    config('.vscode', '{ "version": "2.0.0", "tasks": [] }')
    expect(await ensureTasksFile(root)).toBe('.vscode/tasks.json')
  })
})
