import {useEffect, useState} from 'react'

/**
 * Returns Date.now() that re-renders the calling component once per second
 * while `active` is true. When `active` is false, returns a static snapshot
 * and tears down the interval — avoids burning render cycles when nothing
 * needs a live elapsed time.
 */
export function useTickingNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = globalThis.setInterval(() => setNow(Date.now()), intervalMs)
    return () => {
      globalThis.clearInterval(id)
    }
  }, [active, intervalMs])
  return now
}
