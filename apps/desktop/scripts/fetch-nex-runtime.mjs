// Tải binary runtime Nex (OpenCode) cho nền tảng hiện tại (hoặc --platform), kiểm sha256,
// giải nén vào apps/desktop/build-resources/opencode/ để electron-builder chép vào bộ cài.
// Idempotent: binary đã đúng sha thì bỏ qua, nên chạy lại trước mỗi lần package là rẻ.
// Logic tải/giải nén/đặt binary nằm ở nex-runtime-fetch.mjs (test được bằng phụ thuộc giả).
//
//   node scripts/fetch-nex-runtime.mjs [--platform darwin-arm64|windows-x64] [--out <thư mục>]
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchNexRuntime } from './nex-runtime-fetch.mjs'
import { NEX_RUNTIME_CONFIG, NEX_RUNTIME_SUPPORTED, loadNexRuntime, platformOs } from './nex-runtime.mjs'

const DEFAULT_OUT = fileURLToPath(new URL('../build-resources/opencode', import.meta.url))
const usage = `Cách dùng: node scripts/fetch-nex-runtime.mjs [--platform <${NEX_RUNTIME_SUPPORTED.join('|')}>] [--out <thư mục>]`

function parseArgs(argv) {
  const options = { platform: null, out: DEFAULT_OUT }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--platform') options.platform = argv[++i]
    else if (arg === '--out') options.out = resolve(argv[++i])
    else if (arg === '--help' || arg === '-h') {
      console.log(usage)
      process.exit(0)
    } else throw new Error(`Tham số lạ: ${arg}\n${usage}`)
  }
  return options
}

/** Khoá asset → (nền tảng Node, arch) để tái dùng chung logic với tệp ghim. */
function platformFromKey(key) {
  const arch = key.split('-').slice(1).join('-')
  return { platform: platformOs(key), arch }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { platform, arch } = options.platform
    ? platformFromKey(options.platform)
    : { platform: process.platform, arch: process.arch }
  await fetchNexRuntime({ config: loadNexRuntime(NEX_RUNTIME_CONFIG), platform, arch, out: options.out })
}

main().catch((error) => {
  console.error(`fetch-nex-runtime: ${error.message}`)
  process.exitCode = 1
})
