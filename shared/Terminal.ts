const knownOverrides = [
  'STRIPE_API_KEY',
  'STRIPE_LIVE',
  'STRIPE_PROJECT_NAME',
  'STRIPE_API_BASE',
  'STRIPE_DASHBOARD_BASE',
  'STRIPE_ACCESS_BASE',
  'STRIPE_TELEMETRY_URL'
]

export function stripeTerminalCommand(
  binary: string,
  config: string,
  platform: NodeJS.Platform,
  inheritedKeys: string[] = []
): string {
  if ([binary, config].some((value) => !value || value.includes('\0')))
    throw new Error('Invalid Stripe CLI path.')
  if (platform === 'win32') {
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
    return [
      'Get-ChildItem Env:STRIPE_* | Remove-Item -ErrorAction SilentlyContinue',
      "$env:STRIPE_CLI_TELEMETRY_OPTOUT = '1'",
      "$env:STRIPE_NO_AUTO_UPDATE = '1'",
      `function global:stripe { & ${quote(binary)} '--config' ${quote(config)} @args }`,
      "Write-Host 'FlyEnv Stripe CLI: same account configuration as the plugin.'",
      "Write-Host 'Try: stripe --help, stripe trigger payment_intent.succeeded, stripe products list'",
      'stripe --version'
    ].join('\n')
  }
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
  const keys = [...new Set([...knownOverrides, ...inheritedKeys])].filter((key) =>
    /^STRIPE_[A-Za-z0-9_]+$/.test(key)
  )
  return [
    ...keys.map((key) => `unset ${key}`),
    'export STRIPE_CLI_TELEMETRY_OPTOUT=1 STRIPE_NO_AUTO_UPDATE=1',
    `stripe() { ${quote(binary)} --config ${quote(config)} "$@"; }`,
    ...(platform === 'linux' ? ['export -f stripe'] : []),
    "printf '%s\\n' 'FlyEnv Stripe CLI: same account configuration as the plugin.'",
    "printf '%s\\n' 'Try: stripe --help, stripe trigger payment_intent.succeeded, stripe products list'",
    'stripe --version'
  ].join('\n')
}
