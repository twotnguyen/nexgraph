import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180_000, windowsHide: true, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${basename(command)} thất bại (${result.status ?? result.signal})${detail ? `\n${detail}` : ''}`)
  }
}

function requireFile(path) {
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) throw new Error(`Không tìm thấy tệp ${path}`)
}

async function withCleanup(action, cleanup) {
  let failure
  try {
    return await action()
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      cleanup()
    } catch (error) {
      if (failure) throw new AggregateError([failure, error], 'Kiểm bộ cài và dọn dữ liệu đều thất bại')
      throw error
    }
  }
}

function requireCleanWindowsInstall() {
  // NSIS can remove an existing installation with the same identity, even with /D.
  const source = String.raw`
    $ErrorActionPreference = 'Stop'
    if (Get-Process -Name NexGraph -ErrorAction SilentlyContinue) { throw 'NexGraph is already running' }
    foreach ($hive in @('HKCU:', 'HKLM:')) {
      foreach ($software in @('Software', 'Software\WOW6432Node')) {
        $root = Join-Path $hive "$software\Microsoft\Windows\CurrentVersion\Uninstall"
        if (Test-Path -LiteralPath $root) {
          foreach ($entry in Get-ChildItem -LiteralPath $root) {
            if ($entry.GetValue('DisplayName') -like 'NexGraph*') { throw 'NexGraph is already registered as installed' }
          }
        }
      }
    }
  `
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')])
}

function runNsis(executable, args) {
  // /D= and _?= consume the rest of the command line without quotes, including spaces.
  // Quote argv[0] separately when disabling Node's automatic argument quoting.
  run(executable, args, { argv0: `"${executable}"`, windowsVerbatimArguments: true })
}

async function smokeNsis(installer, temp, smoke) {
  requireCleanWindowsInstall()
  const dir = join(temp, 'NexGraph NSIS')
  const binary = join(dir, 'NexGraph.exe')
  const uninstaller = join(dir, 'Uninstall NexGraph.exe')
  await withCleanup(async () => {
    runNsis(installer, ['/S', '/currentuser', `/D=${dir}`])
    requireFile(binary)
    requireFile(uninstaller)
    requireFile(join(dir, 'resources', 'engine', 'nexgraph-engine.exe'))
    await smoke(binary)
  }, () => {
    if (existsSync(uninstaller)) {
      runNsis(uninstaller, ['/S', '/currentuser', '/KEEP_APP_DATA', `_?=${dir}`])
      if (existsSync(binary)) throw new Error(`NSIS chưa gỡ tệp ${binary}`)
    }
  })
}

async function smokeDmg(installer, temp, smoke) {
  // Keep the mount outside the app's temp tree so that a failed detach cannot lead to recursive removal of a mounted volume.
  const mount = realpathSync(mkdtempSync(join(tmpdir(), 'ng-smoke-dmg-')))
  const parentDevice = statSync(dirname(mount)).dev
  const app = join(temp, 'NexGraph.app')
  let attached = false
  await withCleanup(() => {
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, installer])
    attached = true
    run('ditto', [join(mount, 'NexGraph.app'), app])
  }, () => {
    // Also detach if attach returned an error after mounting the image.
    if (attached || (existsSync(mount) && statSync(mount).dev !== parentDevice)) {
      run('hdiutil', ['detach', mount])
    }
    if (existsSync(mount)) rmdirSync(mount)
  })
  const binary = join(app, 'Contents', 'MacOS', 'NexGraph')
  requireFile(binary)
  requireFile(join(app, 'Contents', 'Resources', 'engine', 'nexgraph-engine'))
  await smoke(binary)
}

export async function smokeInstaller(installer, temp, smoke) {
  const extension = { win32: '.exe', darwin: '.dmg' }[process.platform]
  if (!extension || extname(installer).toLowerCase() !== extension) {
    throw new Error(`Bộ cài ${basename(installer)} không phù hợp với nền tảng ${process.platform}`)
  }
  requireFile(installer)
  if (process.platform === 'win32') await smokeNsis(installer, temp, smoke)
  else await smokeDmg(installer, temp, smoke)
}
