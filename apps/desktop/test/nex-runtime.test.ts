import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { download, fetchNexRuntime, moveFileVerified } from '../scripts/nex-runtime-fetch.mjs'
import {
  type NexRuntimeAsset,
  type NexRuntimeConfig,
  assetFor,
  assertSha256,
  binaryName,
  isRuntimeCurrent,
  loadNexRuntime,
  platformKey,
  runtimeBinaryPath,
  sha256File
} from '../scripts/nex-runtime.mjs'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ng-nex-runtime-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('nex-runtime: tệp ghim runtime Nex (PKG-NEX-1)', () => {
  const config = loadNexRuntime()

  it('ghim OpenCode 2.4.1 với đủ hai nền tảng và sha256 64 ký tự', () => {
    expect(config.version).toBe('2.4.1')
    for (const key of ['darwin-arm64', 'windows-x64']) {
      const asset = config.assets[key]
      expect(asset, `thiếu asset ${key}`).toBeTruthy()
      expect(asset.url).toMatch(/^https:\/\/github\.com\/anomalyco\/opencode\/releases\/download\/v2\.4\.1\//)
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(asset.binarySha256).toMatch(/^[0-9a-f]{64}$/)
      expect(asset.bytes).toBeGreaterThan(100 * 1000 * 1000)
    }
  })

  it('ánh xạ platform/arch sang khoá asset, nền tảng lạ thì báo rõ', () => {
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(platformKey('win32', 'x64')).toBe('windows-x64')
    expect(() => platformKey('darwin', 'x64')).toThrow(/darwin-arm64.*windows-x64/)
    expect(() => platformKey('linux', 'x64')).toThrow(/chưa hỗ trợ/)
  })

  it('tên binary đúng nền tảng và nằm trong thư mục opencode/', () => {
    expect(binaryName('darwin')).toBe('opencode')
    expect(binaryName('win32')).toBe('opencode.exe')
    expect(runtimeBinaryPath('/tmp/out', 'darwin')).toBe(join('/tmp/out', 'opencode'))
    expect(runtimeBinaryPath('C:\\out', 'win32')).toBe(join('C:\\out', 'opencode.exe'))
  })

  it('assetFor trả đúng mục theo platform/arch', () => {
    expect(assetFor(config, 'darwin', 'arm64')).toBe(config.assets['darwin-arm64'])
    expect(assetFor(config, 'win32', 'x64')).toBe(config.assets['windows-x64'])
  })

  it('sha256File tính đúng sha256 của tệp', async () => {
    const file = join(root, 'abc.bin')
    writeFileSync(file, 'abc')
    await expect(sha256File(file)).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('sai sha256 thì fail kèm cả giá trị mong đợi và nhận được', () => {
    expect(() => assertSha256('aa', 'aa', 'tệp.zip')).not.toThrow()
    expect(() => assertSha256('bb', 'aa', 'opencode-darwin-arm64.zip')).toThrow(/opencode-darwin-arm64\.zip.*aa.*bb/)
  })

  it('isRuntimeCurrent: thiếu tệp hoặc sai nội dung là false, đúng sha là true', async () => {
    const file = join(root, 'opencode')
    const src = join(root, 'src.bin')
    writeFileSync(src, 'noi dung')
    const expected = await sha256File(src)
    await expect(isRuntimeCurrent(file, expected)).resolves.toBe(false)
    writeFileSync(file, 'sai')
    await expect(isRuntimeCurrent(file, expected)).resolves.toBe(false)
    writeFileSync(file, 'noi dung')
    await expect(isRuntimeCurrent(file, expected)).resolves.toBe(true)
  })
})

// Kỳ vọng tính độc lập bằng node:crypto, không dùng sha256File của mã đang kiểm.
const sha256Of = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const ZIP = Buffer.from('zip giả lập của OpenCode')
const BINARY = Buffer.from('binary giả lập của OpenCode')

function exdevError(from: string, to: string) {
  return Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${from}' -> '${to}'`), {
    code: 'EXDEV',
    syscall: 'rename'
  })
}

describe('nex-runtime: đặt binary vào đích khi tạm và đích khác ổ đĩa (sửa CI Windows EXDEV)', () => {
  // Mô phỏng lỗi thật của CI run 45700544939: %TEMP% ở C:, workspace ở D: nên rename ném EXDEV.
  // "Ổ D:" = thư mục build-resources của fixture; mọi đường dẫn ngoài nó (os.tmpdir()) là "ổ C:".
  function fixture(overrides: Partial<NexRuntimeAsset> = {}) {
    const drive = join(root, 'build-resources')
    const out = join(drive, 'opencode')
    const config: NexRuntimeConfig = {
      version: '9.9.9',
      source: 'https://example.test',
      assets: {
        'windows-x64': {
          url: 'https://example.test/opencode-windows-x64.zip',
          filename: 'opencode-windows-x64.zip',
          sha256: sha256Of(ZIP),
          binarySha256: sha256Of(BINARY),
          bytes: ZIP.length,
          binary: 'opencode.exe',
          ...overrides
        }
      }
    }
    const seen = { zips: [] as string[], extracted: [] as string[], renames: [] as Array<[string, string]> }
    const onDriveD = (path: string) => {
      const rel = relative(drive, path)
      return !rel.startsWith('..') && !isAbsolute(rel)
    }
    const deps = {
      download: async (_url: string, dest: string) => {
        seen.zips.push(dest)
        writeFileSync(dest, ZIP)
      },
      extract: (zip: string, destDir: string) => {
        seen.extracted.push(zip)
        mkdirSync(join(destDir, 'pkg'), { recursive: true })
        writeFileSync(join(destDir, 'pkg', 'opencode.exe'), BINARY)
      },
      rename: (from: string, to: string) => {
        seen.renames.push([from, to])
        if (onDriveD(from) !== onDriveD(to)) throw exdevError(from, to)
        renameSync(from, to)
      }
    }
    const run = (extra: Parameters<typeof fetchNexRuntime>[0]['deps'] = {}, log: (line: string) => void = () => {}) =>
      fetchNexRuntime({ config, platform: 'win32', arch: 'x64', out, log, deps: { ...deps, ...extra } })
    return { drive, out, dest: join(out, 'opencode.exe'), seen, run }
  }

  it('tạm khác ổ với đích (EXDEV) không làm fetch hỏng: binary vẫn vào đích đúng sha256', async () => {
    const { dest, run } = fixture()
    await expect(run()).resolves.toMatchObject({ status: 'fetched', dest })
    expect(readFileSync(dest)).toEqual(BINARY)
  })

  it('giải nén vào thư mục tạm cùng thư mục cha với đích (không phải os.tmpdir) và dọn sạch khi xong', async () => {
    const { drive, run, seen } = fixture()
    await run({ rename: renameSync }) // rename thật: chỉ kiểm chỗ đặt thư mục tạm
    const staging = dirname(seen.zips[0])
    expect(dirname(staging)).toBe(drive)
    expect(readdirSync(drive)).toEqual(['opencode'])
  })

  it('đích đã đúng sha256 thì bỏ qua: không tải, không giải nén', async () => {
    const { out, dest, run, seen } = fixture()
    mkdirSync(out, { recursive: true })
    writeFileSync(dest, BINARY)
    await expect(run()).resolves.toMatchObject({ status: 'current', dest })
    expect(seen.zips).toEqual([])
    expect(seen.extracted).toEqual([])
  })

  it('zip sai sha256 thì dừng trước khi giải nén; đích giữ nguyên, thư mục tạm bị dọn', async () => {
    const { drive, out, dest, run, seen } = fixture({ sha256: sha256Of('zip khác') })
    mkdirSync(out, { recursive: true })
    writeFileSync(dest, 'bản cũ')
    await expect(run()).rejects.toThrow(/Sai sha256 của opencode-windows-x64\.zip/)
    expect(seen.extracted).toEqual([])
    expect(readFileSync(dest, 'utf8')).toBe('bản cũ')
    expect(readdirSync(drive)).toEqual(['opencode'])
  })

  it('binary sai sha256 thì không đặt vào đích (không rename); đích giữ nguyên, thư mục tạm bị dọn', async () => {
    const { drive, out, dest, run, seen } = fixture({ binarySha256: sha256Of('binary khác') })
    mkdirSync(out, { recursive: true })
    writeFileSync(dest, 'bản cũ')
    await expect(run()).rejects.toThrow(/Sai sha256 của opencode\.exe trong opencode-windows-x64\.zip/)
    expect(seen.renames).toEqual([])
    expect(readFileSync(dest, 'utf8')).toBe('bản cũ')
    expect(readdirSync(drive)).toEqual(['opencode'])
  })

  it('dọn thư mục tạm lỗi (EBUSY) thì chỉ cảnh báo, không che lỗi gốc', async () => {
    const { run } = fixture({ sha256: sha256Of('zip khác') })
    const logs: string[] = []
    const rm = () => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    }
    await expect(run({ rm }, (line) => logs.push(line))).rejects.toThrow(/Sai sha256/)
    expect(logs.join('\n')).toMatch(/Không dọn được thư mục tạm.*EBUSY/)
  })
})

describe('nex-runtime: moveFileVerified (rename, dự phòng EXDEV có kiểm sha256 lại)', () => {
  function files() {
    const src = join(root, 'c-drive', 'opencode.exe')
    const dest = join(root, 'd-drive', 'opencode.exe')
    mkdirSync(dirname(src), { recursive: true })
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(src, BINARY)
    // Hai thư mục khác nhau = hai ổ: rename giữa chúng ném EXDEV, rename trong cùng thư mục chạy thật.
    const renames: Array<[string, string]> = []
    const rename = (from: string, to: string) => {
      renames.push([from, to])
      if (dirname(from) !== dirname(to)) throw exdevError(from, to)
      renameSync(from, to)
    }
    return { src, dest, renames, rename }
  }

  it('cùng ổ thì rename thẳng', async () => {
    const { src } = files()
    const moved = join(dirname(src), 'moi.exe')
    await expect(moveFileVerified(src, moved, sha256Of(BINARY), 'opencode.exe')).resolves.toBe('rename')
    expect(readFileSync(moved)).toEqual(BINARY)
    expect(existsSync(src)).toBe(false)
  })

  it('EXDEV: chép sang tệp tạm cạnh đích, kiểm sha256 lại, đặt vào đích rồi xoá nguồn', async () => {
    const { src, dest, renames, rename } = files()
    await expect(moveFileVerified(src, dest, sha256Of(BINARY), 'opencode.exe', { rename })).resolves.toBe('copy')
    expect(readFileSync(dest)).toEqual(BINARY)
    expect(existsSync(src)).toBe(false)
    expect(readdirSync(dirname(dest))).toEqual(['opencode.exe']) // không sót tệp tạm
    expect(renames[0]).toEqual([src, dest]) // thử rename thẳng trước
    expect(dirname(renames[1][0])).toBe(dirname(dest)) // rồi đặt từ tệp tạm cùng thư mục với đích
  })

  it('EXDEV mà bản chép sai nội dung (sha256 lệch) thì fail, đích giữ bản cũ, tệp tạm bị xoá', async () => {
    const { src, dest, rename } = files()
    writeFileSync(dest, 'bản cũ')
    const copyFile = (_from: string, to: string) => writeFileSync(to, 'nội dung hỏng')
    await expect(moveFileVerified(src, dest, sha256Of(BINARY), 'opencode.exe', { rename, copyFile }))
      .rejects.toThrow(/Sai sha256 của opencode\.exe/)
    expect(readFileSync(dest, 'utf8')).toBe('bản cũ')
    expect(readdirSync(dirname(dest))).toEqual(['opencode.exe'])
    expect(existsSync(src)).toBe(true) // chưa đặt được thì không xoá nguồn
  })

  it('lỗi khác EXDEV thì ném nguyên văn, không chép dự phòng', async () => {
    const { src, dest } = files()
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    let copies = 0
    await expect(moveFileVerified(src, dest, sha256Of(BINARY), 'opencode.exe', {
      rename: () => {
        throw denied
      },
      copyFile: () => {
        copies += 1
      }
    })).rejects.toBe(denied)
    expect(copies).toBe(0)
  })
})

describe('nex-runtime: download có hạn chót (AbortSignal.timeout)', () => {
  // Server thật trên 127.0.0.1: không mock fetch, nên test chứng minh đúng hành vi mạng bị treo.
  let server: Server
  let base = ''
  const sockets = new Set<Socket>()

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-length': '5' })
        res.end('hello')
      } else if (req.url === '/missing') {
        res.writeHead(404, 'Not Found')
        res.end()
      } else if (req.url === '/stall') {
        res.writeHead(200, { 'content-length': '1000' })
        res.write('mới gửi dở') // gửi một phần rồi treo, không bao giờ end()
      }
      // '/hang': không trả lời gì.
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('tải thành công thì ghi đúng nội dung', async () => {
    const dest = join(root, 'ok.bin')
    await download(`${base}/ok`, dest, { timeoutMs: 5_000 })
    expect(readFileSync(dest, 'utf8')).toBe('hello')
  })

  it('HTTP lỗi thì báo mã trạng thái', async () => {
    await expect(download(`${base}/missing`, join(root, 'x.bin'), { timeoutMs: 5_000 })).rejects.toThrow(/HTTP 404/)
  })

  it('server không trả lời thì bị ngắt đúng hạn chót kèm thông báo rõ (không treo vô hạn)', async () => {
    const started = Date.now()
    await expect(download(`${base}/hang`, join(root, 'hang.bin'), { timeoutMs: 200 })).rejects.toThrow(/quá 0\.2 s/)
    expect(Date.now() - started).toBeLessThan(3_000)
  }, 4_000)

  it('server gửi dở rồi treo giữa chừng cũng bị ngắt đúng hạn chót', async () => {
    const started = Date.now()
    await expect(download(`${base}/stall`, join(root, 'stall.bin'), { timeoutMs: 200 })).rejects.toThrow(/quá 0\.2 s/)
    expect(Date.now() - started).toBeLessThan(3_000)
  }, 4_000)
})
