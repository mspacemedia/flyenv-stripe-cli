import type { AppHost } from '@shared/app'
import { buildSiteHostnames, isDirectProjectSite, isTomcatSite } from '@shared/siteRuntime'

type StripeSite = Pick<
  AppHost,
  'name' | 'alias' | 'useSSL' | 'port' | 'type' | 'subType' | 'projectPort'
>

export function stripeSiteTargets(sites: StripeSite[], server: string): Array<{ value: string }> {
  return sites.flatMap((site) => {
    if (isDirectProjectSite(site)) {
      return site.projectPort
        ? [{ value: `http://127.0.0.1:${site.projectPort}/stripe/webhook` }]
        : []
    }
    const flag = isTomcatSite(site) ? 'tomcat' : server
    const key = `${flag}${site.useSSL ? '_ssl' : ''}` as keyof AppHost['port']
    const port = site.port?.[key] ?? (site.useSSL ? 443 : 80)
    const suffix = port === (site.useSSL ? 443 : 80) ? '' : `:${port}`
    return buildSiteHostnames(site).map((host) => ({
      value: `${site.useSSL ? 'https' : 'http'}://${host}${suffix}/stripe/webhook`
    }))
  })
}
