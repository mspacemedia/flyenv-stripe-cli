export type GitHubRelease = {
  tag_name: string
  draft?: boolean
  prerelease?: boolean
  assets: Array<{ name: string; browser_download_url: string }>
}

export function stripeAssetSuffix(platform: string, arch: string): string {
  const os = { win32: 'windows', darwin: 'mac-os', linux: 'linux' }[platform]
  // Windows arm64 can run the official x64 binary through Windows emulation.
  const cpu =
    arch === 'arm64' && platform !== 'win32'
      ? 'arm64'
      : arch === 'ia32'
        ? 'i386'
        : arch === 'x64' || (arch === 'arm64' && platform === 'win32')
          ? 'x86_64'
          : ''
  if (!os || !cpu) throw new Error(`Stripe CLI does not support ${platform}/${arch}.`)
  return `${os}_${cpu}.${platform === 'win32' ? 'zip' : 'tar.gz'}`
}

export function stripeReleaseAssets(releases: GitHubRelease[], platform: string, arch: string) {
  const suffix = stripeAssetSuffix(platform, arch)
  return releases.flatMap((release) => {
    if (!release || typeof release.tag_name !== 'string' || !Array.isArray(release.assets))
      return []
    if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return []
    const version = release.tag_name.slice(1)
    const asset = release.assets.find((item) => item && item.name === `stripe_${version}_${suffix}`)
    if (!asset) return []
    // The release API must not redirect installation to an unrelated download source.
    if (
      asset.browser_download_url !==
      `https://github.com/stripe/stripe-cli/releases/download/v${version}/${asset.name}`
    )
      return []
    return [{ version, name: asset.name, url: asset.browser_download_url }]
  })
}
