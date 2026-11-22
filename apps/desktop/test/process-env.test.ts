import { describe, expect, it } from 'vitest'
import { safeProcessEnv, userShellEnv } from '../src/main/process-env'
import { gitEnv } from '../src/main/git/repo'
import { lspEnv } from '../src/main/lsp/manager'
import { debugEnv } from '../src/main/debug/manager'

/** Môi trường "bẩn" như khi người dùng mở app từ shell có credential. */
const dirty: NodeJS.ProcessEnv = {
  PATH: '/usr/local/bin:/usr/bin',
  HOME: '/Users/thử',
  LANG: 'vi_VN.UTF-8',
  SHELL: '/bin/zsh',
  TERM: 'xterm-256color',
  USER: 'thử',
  TMPDIR: '/var/folders/tmp',
  SystemRoot: 'C:\\Windows',
  ComSpec: 'C:\\Windows\\cmd.exe',
  PATHEXT: '.COM;.EXE',
  APPDATA: 'C:\\Users\\thử\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\thử\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  AWS_ACCESS_KEY_ID: 'AKIA-thử',
  AWS_SECRET_ACCESS_KEY: 'bí-mật',
  AWS_PROFILE: 'thử',
  GH_TOKEN: 'ghp_thử',
  GITHUB_TOKEN: 'ghp_thử',
  NPM_TOKEN: 'npm_thử',
  OPENAI_API_KEY: 'sk-thử',
  ANTHROPIC_API_KEY: 'sk-ant-thử',
  SSH_AUTH_SOCK: '/tmp/ssh-thử.sock',
  DATABASE_SECRET: 'bí-mật',
  DEPLOY_KEY: 'bí-mật',
  PYTHONPATH: '/Users/thử/.hermes/venv/lib/python3.14/site-packages',
  PYTHONHOME: '/Users/thử/.hermes/venv',
  NODE_OPTIONS: '--require /tmp/chèn.js',
  LD_PRELOAD: '/tmp/chèn.so',
  NEXGRAPH_TOKEN: 'token-nội-bộ'
}

const secretKeys = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_PROFILE', 'GH_TOKEN', 'GITHUB_TOKEN',
  'NPM_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'SSH_AUTH_SOCK', 'DATABASE_SECRET', 'DEPLOY_KEY',
  'PYTHONPATH', 'PYTHONHOME', 'NODE_OPTIONS', 'LD_PRELOAD']

const expectNoSecrets = (env: NodeJS.ProcessEnv) => {
  for (const key of secretKeys) expect(env, key).not.toHaveProperty(key)
}

describe('safeProcessEnv', () => {
  it('giữ biến hệ thống cần thiết cho tiến trình con', () => {
    const env = safeProcessEnv(dirty)
    for (const key of ['PATH', 'HOME', 'LANG', 'SHELL', 'TERM', 'USER', 'TMPDIR',
      'SystemRoot', 'ComSpec', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles']) {
      expect(env[key], key).toBe(dirty[key])
    }
  })

  it('bỏ mọi biến bí mật và cấu hình Python/Node của tiến trình cha', () => {
    expectNoSecrets(safeProcessEnv(dirty))
  })

  it('extra của mã nội bộ được phép ghi đè', () => {
    expect(safeProcessEnv(dirty, { LC_ALL: 'C', ELECTRON_RUN_AS_NODE: '1' })).toMatchObject({
      LC_ALL: 'C', ELECTRON_RUN_AS_NODE: '1', PATH: dirty.PATH
    })
  })
})

describe('env của từng tiến trình con', () => {
  it('git, LSP, debug không nhận credential của tiến trình cha', () => {
    for (const env of [gitEnv(dirty), lspEnv(dirty), debugEnv({}, dirty)]) expectNoSecrets(env)
  })

  it('git giữ PATH để tìm lệnh git', () => {
    expect(gitEnv(dirty).PATH).toBe(dirty.PATH)
  })

  it('LSP nhận ELECTRON_RUN_AS_NODE nhưng không nhận NODE_OPTIONS', () => {
    const env = lspEnv(dirty)
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env).not.toHaveProperty('NODE_OPTIONS')
  })

  it('debug adapter Python chỉ nhận PYTHONPATH do NexGraph đặt', () => {
    const env = debugEnv({ PYTHONPATH: '/app/adapters/python' }, dirty)
    expect(env.PYTHONPATH).toBe('/app/adapters/python')
  })
})

describe('userShellEnv (terminal tích hợp)', () => {
  it('giữ env người dùng để CLI của họ chạy được, chỉ bỏ token nội bộ của NexGraph', () => {
    const env = userShellEnv(dirty)
    expect(env.AWS_PROFILE).toBe('thử')
    expect(env.GH_TOKEN).toBe(dirty.GH_TOKEN)
    expect(env).not.toHaveProperty('NEXGRAPH_TOKEN')
  })
})
