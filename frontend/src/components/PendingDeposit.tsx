import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { explorerTx } from '@/lib/config'
import { friendlyError } from '@/lib/errors'
import { fmtTry, fmtUsd } from '@/lib/money'
import {
  markSent,
  removePending,
  resolvePending,
  usePendingStatus,
  type PendingDeposit,
} from '@/lib/pending'
import { StepLog } from './ContributeSheet'
import { Button, Card, Pill, cx } from './ui'

/**
 * One pending bank deposit: the IBAN card while the bank leg is open, then the
 * anchor's progress, then the on-chain contribution. Used inside the sheet
 * and as a banner on the pool page, both backed by the same resolver.
 */
export function PendingDepositCard({
  pending,
  onContributed,
  compact,
}: {
  pending: PendingDeposit
  onContributed: () => void
  compact?: boolean
}) {
  const { signer } = useWallet()
  const status = usePendingStatus(pending.orderId)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    resolvePending(pending, signer, onContributed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.orderId, signer.address, status?.stage === 'error' ? 0 : 1])

  const stage = status?.stage ?? 'bank'
  const sent = async () => {
    setBusy(true)
    setErr(null)
    try {
      await markSent(pending, signer)
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  const retry = () => {
    setErr(null)
    resolvePending(pending, signer, onContributed)
  }

  const lines = [
    { key: 'bank', text: `Bank transfer of ${fmtTry(pending.tryAmount)}`, sub: stage === 'bank' ? 'waiting for you' : 'sent (simulated)', state: stage === 'bank' ? ('active' as const) : ('done' as const) },
    ...(stage !== 'bank'
      ? [{ key: 'anchor', text: 'Anchor converting ₺ to USDC', sub: status?.anchorStatus ? anchorLabel(status.anchorStatus) : undefined, state: stage === 'anchor' ? ('active' as const) : stage === 'error' && !status?.txHash ? ('error' as const) : ('done' as const) }]
      : []),
    ...(stage === 'landed' || stage === 'contributing' || stage === 'done'
      ? [{ key: 'chain', text: `Adding ${fmtUsd(pending.usd)} to the pool on Stellar`, state: stage === 'done' ? ('done' as const) : ('active' as const) }]
      : []),
  ]

  return (
    <Card className={cx('p-4', compact && 'border border-line')}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[15px] font-bold">
          {stage === 'done' ? 'You’re in!' : 'Your bank transfer'}
        </h3>
        <Pill tone={stage === 'done' ? 'accent' : 'outline'}>{stage === 'done' ? 'Added' : 'Simulated bank'}</Pill>
      </div>
      <StepLog lines={lines} />

      {stage === 'bank' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl bg-bg p-3">
          <dl className="space-y-2 text-[14px]">
            <Row k="Send" v={fmtTry(pending.tryAmount)} />
            <Row k="Bank" v={pending.bankName ?? 'TR Mock Bank'} />
            <Row k="IBAN" v={pending.iban ?? '—'} mono />
            <Row k="Description" v={pending.reference ?? '—'} mono />
          </dl>
          <p className="mt-3 text-[12px] text-muted">
            In real life you'd send this from your banking app. This sandbox has no real bank, so the
            button below plays the bank for you.
          </p>
          <Button full variant="accent" size="lg" className="mt-3" onClick={sent} loading={busy}>
            I sent the transfer
          </Button>
        </motion.div>
      )}

      {stage === 'anchor' && (
        <p className="mt-3 text-[13px] text-muted">
          The anchor pays out USDC on Stellar once it sees the lira. This usually takes under a minute,
          sometimes a few. You can close this; Plink finishes it for you when the money lands.
        </p>
      )}

      {stage === 'done' && status?.txHash && (
        <a
          href={explorerTx(status.txHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-[13px] text-muted underline decoration-line-2 underline-offset-2"
        >
          View on Stellar
        </a>
      )}

      {(err || stage === 'error') && (
        <div className="mt-3 space-y-2">
          <p className="text-[13px] text-[#D33]">{err ?? friendlyError(new Error(status?.error ?? 'Something went wrong'))}</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={retry}>
              Try again
            </Button>
            <Button variant="ghost" size="sm" onClick={() => removePending(pending.orderId)}>
              Forget this transfer
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function anchorLabel(s: string) {
  return (
    {
      pending_user_transfer_start: 'waiting for the bank',
      pending_anchor: '₺ received, paying out USDC',
      pending_trust: 'waiting for USDC trustline',
      pending_stellar: 'sending USDC on Stellar',
      completed: 'done',
    }[s] ?? s.replaceAll('_', ' ')
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className={cx('text-right font-semibold break-all', mono && 'font-mono text-[13px]')}>{v}</dd>
    </div>
  )
}
