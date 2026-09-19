import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPool, type PoolStatus, type PoolView } from '@/lib/pool'

/** Live view of a pool: polls RPC every few seconds while the tab is visible. */
export function usePool(id: number, intervalMs = 3000) {
  const [view, setView] = useState<PoolView | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [justFunded, setJustFunded] = useState(false)
  const prevStatus = useRef<PoolStatus | null>(null)

  const load = useCallback(async () => {
    try {
      const v = await fetchPool(id)
      setError(null)
      setView(v)
      if (v) {
        if (prevStatus.current === 'open' && v.status === 'funded') setJustFunded(true)
        prevStatus.current = v.status
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      if (!alive) return
      if (document.visibilityState === 'visible') await load()
      timer = setTimeout(tick, intervalMs)
    }
    tick()
    const onVis = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load, intervalMs])

  return { view, error, reload: load, justFunded, clearJustFunded: () => setJustFunded(false) }
}
