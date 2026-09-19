import { useEffect, useState } from 'react'

export function timeLeft(deadlineSec: number, now = Date.now()) {
  const diff = deadlineSec * 1000 - now
  if (diff <= 0) return { over: true, label: 'Ended' }
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d >= 2) return { over: false, label: `${d} days left` }
  if (h >= 1) return { over: false, label: `${h}h ${m % 60}m left` }
  if (m >= 1) return { over: false, label: `${m} min left` }
  return { over: false, label: 'Under a minute left' }
}

export function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return <>{timeLeft(deadline, now).label}</>
}

export const fmtDate = (sec: number) =>
  new Date(sec * 1000).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
