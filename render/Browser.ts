import IPC from '@/util/IPC'
import { stripeLoginUrl } from '../shared/Arguments'

/** Bounded browser hand-off, including compatibility with existing hosts' true reply. */
export function openStripeBrowser(url: string, timeout = 15_000): Promise<void> {
  const validated = stripeLoginUrl(url)
  return new Promise((resolve, reject) => {
    const request = IPC.sendSensitive('App-Node-FN', 'shell', 'openExternal', validated)
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      IPC.off(request.key)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Opening the Stripe approval page timed out. Try opening it again.'))
    }, timeout)
    try {
      request.then((_key: string, response: any) => {
        if (settled) return
        settled = true
        cleanup()
        if (response === true || response?.code === 0) resolve()
        else reject(new Error(response?.msg || 'Could not open the Stripe approval page.'))
      })
    } catch (error) {
      settled = true
      cleanup()
      reject(error)
    }
  })
}
