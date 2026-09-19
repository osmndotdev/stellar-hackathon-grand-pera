import { createFileRoute, Link } from '@tanstack/react-router'
import { AnimatePresence, motion, animate, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useState } from 'react'
import { useCelebrate } from '@/components/Celebration'
import { ClaimCard, RefundCard } from '@/components/ClaimCard'
import { ContributeSheet } from '@/components/ContributeSheet'
import { PendingDepositCard } from '@/components/PendingDeposit'
import { Countdown, fmtDate } from '@/components/Countdown'
import { ProgressBar } from '@/components/ProgressBar'
import { ShareCard } from '@/components/ShareCard'
import { Avatar, Button, Card, Pill, Spinner, Sticker, cx, shortAddr } from '@/components/ui'
import { usePool } from '@/hooks/usePool'
import { useWallet } from '@/hooks/useWallet'
import { CONTRACT_ID, explorerContract } from '@/lib/config'
import { fmtBase, fmtUsd, pct, toUsdc } from '@/lib/money'
import { usePending } from '@/lib/pending'
import type { PoolStatus } from '@/lib/pool'
import { vibeOf, vibeStyle } from '@/lib/vibes'

export const Route = createFileRoute('/p/$id')({
  component: PoolPage,
  validateSearch: (s: Record<string, unknown>): { new?: boolean } =>
    s.new === true || s.new === 'true' ? { new: true } : {},
})

function PoolPage() {
  const { id } = Route.useParams()
  const { new: fresh } = Route.useSearch()
  const { view, error, reload, justFunded, clearJustFunded } = usePool(Number(id))
  const { signer } = useWallet()
  const [sheet, setSheet] = useState(false)
  const [celebrate, setCelebrate] = useState(false)
  const pending = usePending(Number(id), signer.address)

  useEffect(() => {
    if (justFunded) {
      setCelebrate(true)
      clearJustFunded()
    }
  }, [justFunded, clearJustFunded])
  useCelebrate(celebrate, view ? vibeOf(view.pool.vibe).accent : '#C8FF3D')

  if (view === undefined) {
    return (
      <div className="flex h-60 flex-col items-center justify-center gap-3 text-muted">
        <Spinner />
        {error && <p className="px-4 text-center text-[12px]">{error}</p>}
      </div>
    )
  }
  if (view === null) {
    return (
      <div className="pt-10 text-center">
        <h1 className="font-display text-[24px] font-bold">No such link</h1>
        <p className="mt-2 text-ink-2">Check the address or make a new one.</p>
        <Link to="/" className="mt-4 inline-block underline">
          Create a link
        </Link>
      </div>
    )
  }

  const { pool, contributions, status } = view
  const isCreator = pool.creator === signer.address
  const progress = pct(pool.raised, pool.target)

  return (
    <div style={vibeStyle(pool.vibe)} className="space-y-4 pt-1">
      {fresh && isCreator && <ShareCard pool={pool} fresh />}

      <section className="relative pt-2">
        <div className="mb-3 flex items-start justify-between">
          <Sticker tilt={-6} className="text-[28px] leading-none px-3 py-2">
            {pool.emoji}
          </Sticker>
          <StatusPill status={status} deadline={Number(pool.deadline)} />
        </div>
        <h1 className="font-display text-[30px] leading-[1.08] font-extrabold tracking-tight">{pool.title}</h1>
        <p className="mt-2 text-[14px] text-ink-2">
          <span className="font-semibold text-ink">{pool.organizer}</span> is collecting
          {isCreator && <Pill className="ml-2 align-middle">that's you</Pill>}
        </p>
      </section>

      <Card className="p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="font-display text-[36px] leading-none font-extrabold tabular">
              <CountUp value={toUsdc(pool.raised)} />
            </div>
            <div className="mt-1 text-[14px] text-muted">
              of {fmtBase(pool.target)} · {contributions.length}{' '}
              {contributions.length === 1 ? 'person' : 'people'}
            </div>
          </div>
          <div className="font-display text-[20px] font-bold tabular">{Math.floor(progress)}%</div>
        </div>
        <div className="mt-3">
          <ProgressBar value={progress} />
        </div>
        <AnimatePresence>
          {(status === 'funded' || status === 'claimed') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-display mt-3 flex items-center gap-2 rounded-2xl bg-accent px-3 py-2 text-[14px] font-bold text-on-accent"
            >
              <span className="text-[18px]">🎯</span> Goal reached!
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {!sheet && pending.map((p) => <PendingDepositCard key={p.orderId} pending={p} onContributed={reload} compact />)}

      {status === 'open' && (
        <Button size="lg" full onClick={() => setSheet(true)}>
          Chip in
        </Button>
      )}
      {status === 'funded' && !isCreator && (
        <Button size="lg" full variant="ghost" onClick={() => setSheet(true)}>
          Add a bit more
        </Button>
      )}
      {(status === 'funded' || status === 'claimed') && isCreator && (
        <ClaimCard view={view} onChanged={reload} />
      )}
      {status === 'expired' && <RefundCard view={view} onChanged={reload} />}

      {isCreator && !fresh && status !== 'claimed' && <ShareCard pool={pool} />}

      <section>
        <h2 className="font-display mb-2 px-1 text-[14px] font-bold text-ink-2">
          {contributions.length === 0 && status === 'open' ? 'Be the first to chip in' : 'Who chipped in'}
        </h2>
        <Card className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {contributions.map((c) => (
              <motion.div
                key={c.contributor}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 px-4 py-3"
              >
                <Avatar name={c.name || shortAddr(c.contributor)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">
                    {c.name || shortAddr(c.contributor)}
                    {c.contributor === signer.address && <span className="ml-1 text-muted">(you)</span>}
                  </div>
                  <div className="text-[12px] text-muted">
                    {c.method === 'bank' ? '🏦 Bank transfer' : '◆ USDC'} · {relTime(Number(c.at))}
                  </div>
                </div>
                <div className="font-display text-[16px] font-bold tabular">{fmtBase(c.amount)}</div>
              </motion.div>
            ))}
          </AnimatePresence>
          {contributions.length === 0 && (
            <div className="px-4 py-6 text-center text-[14px] text-muted">
              {status === 'open' ? 'Nobody yet. Go on.' : 'Everyone has taken their money back.'}
            </div>
          )}
        </Card>
      </section>

      <section className="rounded-card bg-black/[0.04] p-4 text-[13px] text-ink-2">
        <div className="font-display mb-1 text-[13px] font-bold text-ink">How this works</div>
        Money is held by a Stellar smart contract, not by {pool.organizer}. If {fmtBase(pool.target)} is
        reached by {fmtDate(Number(pool.deadline))}, {pool.organizer} can claim it. If not, everyone
        takes their own contribution back.{' '}
        <a
          className="underline decoration-line-2 underline-offset-2"
          href={explorerContract(CONTRACT_ID)}
          target="_blank"
          rel="noreferrer"
        >
          See the contract
        </a>
        .
      </section>

      <ContributeSheet
        open={sheet}
        onClose={() => setSheet(false)}
        view={view}
        onContributed={() => {
          reload()
        }}
      />
      {error && <p className="text-center text-[12px] text-muted">Reconnecting… {error}</p>}
    </div>
  )
}

function StatusPill({ status, deadline }: { status: PoolStatus; deadline: number }) {
  if (status === 'open')
    return (
      <Pill tone="outline">
        ⏳ <Countdown deadline={deadline} />
      </Pill>
    )
  if (status === 'funded') return <Pill tone="accent">Funded</Pill>
  if (status === 'claimed') return <Pill tone="ink">Claimed</Pill>
  return <Pill tone="soft">Ended</Pill>
}

function CountUp({ value }: { value: number }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => fmtUsd(v, { maximumFractionDigits: 0 }))
  useEffect(() => {
    const c = animate(mv, value, { type: 'spring', stiffness: 80, damping: 20 })
    return () => c.stop()
  }, [value, mv])
  return <motion.span className={cx('inline-block')}>{text}</motion.span>
}

function relTime(sec: number) {
  const d = Date.now() / 1000 - sec
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}
