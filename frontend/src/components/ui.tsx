import { motion, type HTMLMotionProps } from 'motion/react'
import { forwardRef } from 'react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export { cx }

type Variant = 'ink' | 'accent' | 'ghost' | 'soft' | 'danger'
type Size = 'md' | 'lg' | 'sm'

const variantCls: Record<Variant, string> = {
  ink: 'bg-ink text-white hover:bg-ink-2 disabled:bg-line-2 disabled:text-muted',
  accent: 'bg-accent text-on-accent hover:brightness-95 disabled:bg-line-2 disabled:text-muted',
  ghost: 'bg-transparent text-ink hover:bg-black/5 border border-line-2 disabled:text-muted',
  soft: 'bg-black/5 text-ink hover:bg-black/10 disabled:text-muted',
  danger: 'bg-[#FF3D3D] text-white hover:brightness-95 disabled:bg-line-2',
}
const sizeCls: Record<Size, string> = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-12 px-5 text-[15px]',
  lg: 'h-14 px-6 text-[16px]',
}

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'ref' | 'children'> {
  variant?: Variant
  size?: Size
  full?: boolean
  loading?: boolean
  children?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ink', size = 'md', full, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cx(
        'relative inline-flex items-center justify-center gap-2 rounded-pill font-semibold select-none',
        'transition-colors duration-150 disabled:cursor-not-allowed',
        variantCls[variant],
        sizeCls[size],
        full && 'w-full',
        className as string,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner className="absolute" />}
      <span className={cx('inline-flex items-center gap-2', loading && 'invisible')}>{children}</span>
    </motion.button>
  )
})

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-block size-5 animate-spin rounded-full border-[2.5px] border-current border-t-transparent',
        className,
      )}
      aria-label="Loading"
    />
  )
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-card bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  )
}

export function Pill({
  className,
  tone = 'soft',
  children,
}: {
  className?: string
  tone?: 'soft' | 'accent' | 'ink' | 'outline'
  children: React.ReactNode
}) {
  const t = {
    soft: 'bg-black/5 text-ink-2',
    accent: 'bg-accent text-on-accent',
    ink: 'bg-ink text-white',
    outline: 'border border-line-2 text-ink-2',
  }[tone]
  return (
    <span
      className={cx(
        'inline-flex h-7 items-center gap-1 rounded-pill px-2.5 text-[12px] font-semibold whitespace-nowrap',
        t,
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A tilted sticker, Airbuds style. */
export function Sticker({
  children,
  tilt = -4,
  tone = 'accent',
  className,
}: {
  children: React.ReactNode
  tilt?: number
  tone?: 'accent' | 'ink' | 'white'
  className?: string
}) {
  const t = {
    accent: 'bg-accent text-on-accent',
    ink: 'bg-ink text-white',
    white: 'bg-white text-ink shadow-card',
  }[tone]
  return (
    <motion.span
      initial={{ scale: 0.6, rotate: tilt * 3, opacity: 0 }}
      animate={{ scale: 1, rotate: tilt, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 18 }}
      className={cx(
        'font-display inline-block rounded-2xl px-3 py-1.5 text-[13px] font-bold tracking-tight',
        t,
        className,
      )}
      style={{ rotate: tilt }}
    >
      {children}
    </motion.span>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-muted">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full rounded-2xl border border-line-2 bg-white px-4 h-12 text-[16px] text-ink outline-none focus:border-ink transition-colors'

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  return (
    <span
      className={cx(
        'font-display inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-bold text-ink',
        className,
      )}
    >
      {initial}
    </span>
  )
}

export function shortAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a
}
