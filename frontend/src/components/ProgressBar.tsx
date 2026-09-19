import { motion } from 'motion/react'

export function ProgressBar({ value, height = 16 }: { value: number; height?: number }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div
      className="relative w-full overflow-hidden rounded-pill bg-black/[0.07]"
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="absolute inset-y-0 left-0 rounded-pill bg-accent"
        initial={{ width: 0 }}
        animate={{ width: `${v}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20, mass: 0.8 }}
      />
      {v >= 100 && (
        <motion.div
          className="absolute inset-0 rounded-pill"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
          }}
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut', repeatDelay: 0.6 }}
        />
      )}
    </div>
  )
}
