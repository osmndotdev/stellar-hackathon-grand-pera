import { motion } from 'motion/react'
import { useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import * as anchor from '@/lib/anchor'
import { explorerTx } from '@/lib/config'
import { fmtBase, fmtTry, fmtUsd, toUsdc } from '@/lib/money'
import type { PoolView } from '@/lib/pool'
import { payUsdc, writeClient } from '@/lib/stellar'
import { friendlyError } from '@/routes/index'
import { StepLog } from './ContributeSheet'
import { Button, Card, Pill } from './ui'

type Line = { key: string; text: string; state: 'active' | 'done' | 'error'; sub?: string }

/** Organizer's claim + optional cash-out to IBAN. */
export function ClaimCard({ view, onChanged }: { view: PoolView; onChanged: () => void }) {
  const { signer, ensureReady, balances, refresh } = useWallet()
  const [busy, setBusy] = useState(false)
  const [claimTx, setClaimTx] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [log, setLog] = useState<Line[]>([])
  const [cashout, setCashout] = useState<{ tr: number; iban?: string; tx?: string } | null>(null)
  const [quote, setQuote] = useState<{ tryOut: number } | null>(null)

  const claimed = view.pool.claimed
  const amount = view.pool.raised
  const push = (key: string, text: string, sub?: string) =>
    setLog((l) => [...l.map((x) => (x.state === 'active' ? { ...x, state: 'done' as const } : x)), { key, text, sub, state: 'active' }])
  const finish = () => setLog((l) => l.map((x) => (x.state === 'active' ? { ...x, state: 'done' } : x)))
  const fail = () => setLog((l) => l.map((x) => (x.state === 'active' ? { ...x, state: 'error' } : x)))

  const claim = async () => {
    setBusy(true)
    setErr(null)
    try {
      await ensureReady()
      const tx = await writeClient(signer).claim({ id: view.pool.id })
      const sent = await tx.signAndSend()
      setClaimTx(sent.sendTransactionResponse?.hash ?? null)
      onChanged()
      await refresh()
      anchor.priceUsdcToTry(toUsdc(amount)).then(setQuote).catch(() => {})
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const doCashout = async () => {
    setBusy(true)
    setErr(null)
    setLog([])
    const usdc = Math.min(toUsdc(amount), balances?.usdc ?? toUsdc(amount))
    try {
      push('auth', 'Logging in to the anchor', 'SEP-10')
      await anchor.authenticate(signer)
      push('order', 'Requesting a payout to your IBAN', 'SEP-6 withdraw')
      const order = await anchor.startWithdraw(signer, usdc)
      const iban = order.message?.match(/TR\d{24}/)?.[0]
      push('pay', `Sending ${fmtUsd(usdc, { maximumFractionDigits: 2 })} USDC to the anchor`, `memo ${order.memo}`)
      const hash = await payUsdc(signer, order.accountId, usdc.toFixed(7), order.memo)
      push('wait', 'Anchor paying out ₺ by FAST', 'simulated')
      const done = await anchor.waitForStatus(signer, order.id, (t) => {
        setLog((l) => l.map((x) => (x.key === 'wait' ? { ...x, sub: t.status.replaceAll('_', ' ') } : x)))
      })
      if (done.status !== 'completed') throw new Error(done.message ?? `Anchor status: ${done.status}`)
      finish()
      setCashout({ tr: Number(done.amountOut ?? 0), iban, tx: hash })
      refresh()
    } catch (e) {
      fail()
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[16px] font-bold">You're the organizer</h3>
        <Pill tone={claimed ? 'ink' : 'accent'}>{claimed ? 'Claimed' : 'Ready to claim'}</Pill>
      </div>

      {!claimed && (
        <>
          <p className="mt-1 text-[14px] text-ink-2">
            Goal reached. {fmtBase(amount)} is yours to collect.
          </p>
          <Button full size="lg" variant="accent" className="mt-3" onClick={claim} loading={busy}>
            Claim {fmtBase(amount)}
          </Button>
        </>
      )}

      {claimed && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 space-y-3">
          <p className="text-[14px] text-ink-2">
            {fmtBase(amount)} USDC moved to your account
            {claimTx && (
              <>
                {' '}
                ·{' '}
                <a className="underline decoration-line-2 underline-offset-2" href={explorerTx(claimTx)} target="_blank" rel="noreferrer">
                  view on Stellar
                </a>
              </>
            )}
            .
          </p>
          {!cashout && (
            <div className="rounded-2xl bg-bg p-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold">Cash out to your bank</span>
                <Pill tone="outline">Simulated FAST</Pill>
              </div>
              <p className="mt-1 text-[12px] text-muted">
                Sends the USDC to the anchor, which pays Turkish lira to your IBAN.
                {quote && ` About ${fmtTry(quote.tryOut)}.`}
              </p>
              {log.length > 0 && <StepLog lines={log} />}
              {!busy && log.length === 0 && (
                <Button full variant="ghost" className="mt-3" onClick={doCashout}>
                  Cash out to IBAN
                </Button>
              )}
            </div>
          )}
          {cashout && (
            <div className="rounded-2xl bg-accent-soft p-3 text-[14px]">
              <div className="font-display font-bold">{fmtTry(cashout.tr)} on its way to your bank</div>
              <div className="mt-1 text-[12px] text-ink-2">
                {cashout.iban ? `IBAN ${cashout.iban}` : 'IBAN on file at the anchor'} · simulated payout, no real money moved
                {cashout.tx && (
                  <>
                    {' '}
                    ·{' '}
                    <a className="underline" href={explorerTx(cashout.tx)} target="_blank" rel="noreferrer">
                      USDC payment
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
        </motion.div>
      )}
      {err && <p className="mt-2 text-[13px] text-[#D33]">{err}</p>}
    </Card>
  )
}

/** Contributor's refund on an expired, underfunded pool. */
export function RefundCard({ view, onChanged }: { view: PoolView; onChanged: () => void }) {
  const { signer, refresh } = useWallet()
  const mine = view.contributions.find((c) => c.contributor === signer.address)
  const [busy, setBusy] = useState(false)
  const [tx, setTx] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refund = async () => {
    setBusy(true)
    setErr(null)
    try {
      const t = await writeClient(signer).refund({ id: view.pool.id, contributor: signer.address })
      const sent = await t.signAndSend()
      setTx(sent.sendTransactionResponse?.hash ?? null)
      onChanged()
      refresh()
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  if (tx) {
    return (
      <Card className="bg-accent-soft p-4">
        <h3 className="font-display text-[16px] font-bold">Money's back</h3>
        <p className="mt-1 text-[14px] text-ink-2">
          Your USDC returned to your account.{' '}
          <a className="underline" href={explorerTx(tx)} target="_blank" rel="noreferrer">
            View on Stellar
          </a>
        </p>
      </Card>
    )
  }
  if (!mine) return null
  return (
    <Card className="p-4">
      <h3 className="font-display text-[16px] font-bold">Didn't make it</h3>
      <p className="mt-1 text-[14px] text-ink-2">
        The goal wasn't reached by the deadline, so your {fmtBase(mine.amount)} is yours to take back.
      </p>
      <Button full size="lg" className="mt-3" onClick={refund} loading={busy}>
        Get my {fmtBase(mine.amount)} back
      </Button>
      {err && <p className="mt-2 text-[13px] text-[#D33]">{err}</p>}
    </Card>
  )
}
