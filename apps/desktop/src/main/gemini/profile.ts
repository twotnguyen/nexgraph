import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
export type GeminiProfile = {
  home: string
  gemini: string
  cwd: string
  settings: string
  config: string
  appDataDir: string
  args: string[]
}
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
/** Antigravity receives only our empty transport workspace; NexGraph MCP owns source access. */
export async function prepareGeminiProfile(
  dataDir: string,
  profileId: string,
  projectRoot: string,
  _options: { maxTurns?: number; mcpTools?: string[] } = {}
): Promise<GeminiProfile> {
  if (!isAbsolute(dataDir) || !UUID.test(profileId) || !isAbsolute(projectRoot))
    throw new Error('Phạm vi hồ sơ Google không hợp lệ')
  const home = join(resolve(dataDir), 'antigravity', 'profiles', profileId),
    gemini = join(home, 'gemini')
  const cwd = join(home, 'workspaces', createHash('sha256').update(resolve(projectRoot)).digest('hex'))
  const client = join(home, 'clients', randomUUID()),
    appDataDir = 'antigravity-cli'
  await Promise.all([
    mkdir(join(cwd, '.agents', 'agents'), { recursive: true, mode: 0o700 }),
    mkdir(join(gemini, appDataDir), { recursive: true, mode: 0o700 }),
    mkdir(join(gemini, 'config'), { recursive: true, mode: 0o700 }),
    mkdir(client, { recursive: true, mode: 0o700 }),
    mkdir(join(home, 'roaming'), { recursive: true, mode: 0o700 }),
    mkdir(join(home, 'local'), { recursive: true, mode: 0o700 })
  ])
  const settings = join(gemini, appDataDir, 'settings.json'),
    config = join(gemini, 'config', 'config.json')
  const policy = {
    useG1Credits: false,
    allowNonWorkspaceAccess: false,
    toolPermission: 'request-review',
    permissions: {
      deny: [
        'read_file(*)',
        'write_file(*)',
        'command(*)',
        'read_url(*)',
        'execute_url(*)',
        'download_url(*)'
      ],
      allow: ['mcp(nexgraph/*)']
    }
  }
  const temporary = join(client, 'settings.json')
  await writeFile(temporary, JSON.stringify(policy), { mode: 0o600 })
  await rename(temporary, settings)
  await writeFile(config, JSON.stringify({ userSettings: { useAiCredits: false } }), { mode: 0o600 })
  // Only our custom agent is loaded. Native filesystem, shell, subagents and ambient hooks are excluded.
  await writeFile(
    join(cwd, '.agents', 'agents', 'nexgraph.md'),
    '---\nname: nexgraph\ndescription: Explore and edit code only through NexGraph MCP.\nmainAgent: true\nsubagent: false\nmodel: inherit\ntools: []\ninheritMcp: true\ninheritCustomizations: false\nexcludeDefaultComponents: true\ncommandExecutionPolicy: off\n---\nAll project access must use the NexGraph MCP tools. Paths refer to the source project managed by NexGraph, never this private transport workspace.\n',
    { mode: 0o600 }
  )
  return {
    home,
    gemini,
    cwd,
    settings,
    config,
    appDataDir,
    args: [
      'acp',
      '--gemini-dir',
      gemini,
      '--app-data-dir',
      appDataDir,
      '--agent',
      'nexgraph',
      '--include-default-customizations=false',
      '--disable-telemetry',
      '--process-per-session',
      '--log-file',
      join(client, 'acp.log')
    ]
  }
}
const PASSTHROUGH = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'SYSTEMDRIVE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS'
])
/** Per-child application directories; the host HOME/USERPROFILE and shared Google keyring are untouched. */
export function buildGeminiEnvironment(
  profile: GeminiProfile,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source))
    if (PASSTHROUGH.has(key.toUpperCase()) && value !== undefined) env[key] = value
  return {
    ...env,
    APPDATA: join(profile.home, 'roaming'),
    LOCALAPPDATA: join(profile.home, 'local'),
    AGY_CLI_DISABLE_AUTO_UPDATE: 'true',
    NO_COLOR: '1'
  }
}
