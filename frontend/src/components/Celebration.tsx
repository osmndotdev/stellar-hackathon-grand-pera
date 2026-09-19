import confetti from 'canvas-confetti'
import { useEffect } from 'react'

/** Fires a two-sided confetti burst in the pool's accent + monochrome. */
export function useCelebrate(fire: boolean, accent: string) {
  useEffect(() => {
    if (!fire) return
    const colors = [accent, '#0B0B0B', '#FFFFFF', accent]
    const end = Date.now() + 1400
    const frame = () => {
      confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors, scalar: 1.1 })
      confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors, scalar: 1.1 })
      if (Date.now() < end) requestAnimationFrame(frame)
    }
    confetti({ particleCount: 120, spread: 90, origin: { y: 0.55 }, colors, scalar: 1.2, ticks: 220 })
    frame()
  }, [fire, accent])
}
