import semver from 'semver'

/** Một bản phát hành như GitHub REST API trả về (chỉ các trường dùng tới). */
export interface GithubRelease {
  tag_name: string
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: Array<{ name: string; browser_download_url: string }>
}

export interface MacUpdate {
  version: string
  /** Trang Release (ghi chú thay đổi). */
  pageUrl: string
  /** Tệp DMG đúng kiến trúc máy. */
  dmgUrl: string
}

/** Đang chạy bản thử (alpha/beta/rc) thì nhận cả pre-release; bản chính thức chỉ nhận bản chính thức. */
export function acceptsPrerelease(currentVersion: string): boolean {
  return semver.prerelease(currentVersion) !== null
}

/**
 * Chọn bản mới nhất có DMG cho kiến trúc `arch` và mới hơn `currentVersion`.
 * Bỏ bản nháp, tag không phải semver, và pre-release khi đang chạy bản chính thức.
 */
export function pickMacUpdate(releases: readonly GithubRelease[], currentVersion: string, arch: string): MacUpdate | null {
  const prerelease = acceptsPrerelease(currentVersion)
  let best: MacUpdate | null = null
  for (const release of releases) {
    if (release.draft || (release.prerelease && !prerelease)) continue
    const version = semver.valid(semver.clean(release.tag_name) ?? '')
    if (!version || !semver.gt(version, currentVersion)) continue
    if (best && !semver.gt(version, best.version)) continue
    const dmg = release.assets.find((asset) => asset.name === `NexGraph-${version}-macos-${arch}.dmg`)
    if (!dmg || !isGithubDownload(dmg.browser_download_url) || !isGithubDownload(release.html_url)) continue
    best = { version, pageUrl: release.html_url, dmgUrl: dmg.browser_download_url }
  }
  return best
}

/** Chỉ mở liên kết https của github.com: dữ liệu đến từ mạng nên không tin URL tuỳ ý. */
function isGithubDownload(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password
  } catch {
    return false
  }
}
