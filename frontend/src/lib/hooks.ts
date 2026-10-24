import { useEffect, useRef, useState } from 'react'

/** Angka naik halus dari nilai sebelumnya ke target (respons pada data baru). */
export function useCountUp(target: number | null | undefined, ms = 900, off = false) {
  const [v, setV] = useState(target ?? 0)
  const from = useRef(target ?? 0)
  useEffect(() => {
    if (target === null || target === undefined) return
    if (off) { setV(target); from.current = target; return }
    const a = from.current
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - p, 4)
      setV(a + (target - a) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms, off])
  return v
}

export function useMedia(q: string) {
  const [m, setM] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(q).matches))
  useEffect(() => {
    const mq = window.matchMedia(q)
    const h = () => setM(mq.matches)
    h()
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [q])
  return m
}
export const useIsDesktop = () => useMedia('(min-width: 1024px)')
