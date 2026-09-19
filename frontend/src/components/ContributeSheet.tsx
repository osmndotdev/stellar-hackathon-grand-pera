import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import * as anchor from '@/lib/anchor'
import { explorerTx } from '@/lib/config'
import { fmtTry, fmtUsd, fromUsdc } from '@/lib/money'
import type { PoolView } from '@/lib/pool'
import { getBalances, writeClient } from '@/lib/stellar'
import { getSavedName, saveName } from '@/lib/wallet'
import { friendlyError } from '@/lib/errors'
import { Sheet } from './Sheet'
import { Button, Pill, cx, inputCls } from './ui'

type Method = 'bank' | 'crypto'
type Step = 'form' | 'bank' | 'crypto' | 'done'

interface LogLine {
  key: string
  text: string
  state: 'active' | 'done' | 'error'
  sub?: string
}

const PRESETS = [10, 25, 50, 100]

export function ContributeSheet({
  open,
  onClose,
  view,
  onContributed,
}: {
  open: boolean
  onClose: () => void
  view: PoolView
  onContributed: () => void
}) {
  const { signer, ensureReady, refresh } = useWallet()
  const remaining = Math.max(0, Number(view.pool.target - view.pool.raised) / 1e7)
  const [amount, setAmount] = useState<string>(() => defaultAmount(remaining))
  const [name, setName] = useState(getSavedName())
  const [method, setMethod] = useState<Method>('bank')
  const [step, setStep] = useState<Step>('form')
  const [log, setLog] = useState<LogLine[]>([])
  const [bank, setBank] = useState<anchor.DepositOrder | null>(null)
  const [tryAmount, setTryAmount] = useState<number | null>(null)
  const [rate, setRate] = useState<number | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)

  const usd = Number(amount)
  const valid = usd > 0 && name.trim().length > 0

  // Indicative rate for the ₺ hint.
  useEffect(() => {
    if (!open) return
    anchor
      .priceTryToUsdc(1000)
      .then((p) => setRate(p.tryPerUsdc))
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) return
    getBalances(signer.address)
      .then((b) => setUsdcBalance(b.usdc))
      .catch(() => {})
  }, [open, signer.address])

  const reset = () => {
    setStep('form')
    setLog([])
    setBank(null)
    setTryAmount(null)
    setTxHash(null)
    setErr(null)
    setBusy(false)
  }
  const close = () => {
    if (busy && step !== 'done') return
    onClose()
    setTimeout(reset, 300)
  }

  const push = (key: string, text: string, sub?: string) =>
    setLog((l) => [...l.map((x) => (x.state === 'active' ? { ...x, state: 'done' as const } : x)), { key, text, sub, state: 'active' }])
  const finishLog = () => setLog((l) => l.map((x) => (x.state === 'active' ? { ...x, state: 'done' } : x)))
  const failLog = () => setLog((l) => l.map((x) => (x.state === 'active' ? { ...x, state: 'error' } : x)))

  const contributeOnChain = async (usdcAmount: number, m: Method) => {
    push('chain', 'Adding to the pool on Stellar')
    const client = writeClient(signer)
    const tx = await client.contribute({
      id: view.pool.id,
      from: signer.address,
      amount: fromUsdc(usdcAmount),
      name: name.trim(),
      method: m,
    })
    const sent = await tx.signAndSend()
    const hash = sent.sendTransactionResponse?.hash ?? null
    setTxHash(hash)
    finishLog()
    saveName(name.trim())
    setStep('done')
    onContributed()
    refresh()
  }

  const startBank = async () => {
    setBusy(true)
    setErr(null)
    setStep('bank')
    try {
      push('prep', 'Preparing your Stellar account')
      await ensureReady()
      push('auth', 'Logging in to the anchor', 'SEP-10, signed with your key')
      await anchor.authenticate(signer)
      push('quote', 'Locking today’s ₺ rate', 'SEP-38')
      const p = await anchor.priceTryToUsdc(1000)
      // Add one kuruş so rounding never leaves us short of the USDC amount.
      const tr = Math.ceil(usd * p.tryPerUsdc * 100 + 1) / 100
      setTryAmount(tr)
      setRate(p.tryPerUsdc)
      push('order', 'Creating your bank transfer', 'SEP-6 deposit')
      const order = await anchor.startDeposit(signer, tr)
      setBank(order)
      finishLog()
    } catch (e) {
      failLog()
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const simulateBank = async () => {
    if (!bank || !tryAmount) return
    setBusy(true)
    setErr(null)
    try {
      push('sim', 'Bank transfer on its way', 'simulated by the sandbox')
      await anchor.simulateBankTransfer(signer, bank.id, tryAmount)
      push('wait', 'Anchor converting ₺ to USDC')
      const done = await anchor.waitForStatus(signer, bank.id, (t) => {
        setLog((l) => l.map((x) => (x.key === 'wait' ? { ...x, sub: statusLabel(t.status) } : x)))
      })
      if (done.status !== 'completed') throw new Error(done.message ?? `Anchor status: ${done.status}`)
      push('landed', 'USDC landed in your account', done.stellarTxId ? 'on Stellar testnet' : undefined)
      const b = await getBalances(signer.address)
      const give = Math.min(usd, Math.floor(b.usdc * 1e7) / 1e7)
      await contributeOnChain(give, 'bank')
    } catch (e) {
      failLog()
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const startCrypto = async () => {
    setBusy(true)
    setErr(null)
    setStep('crypto')
    try {
      push('prep', 'Checking your account')
      await ensureReady()
      const b = await getBalances(signer.address)
      setUsdcBalance(b.usdc)
      if (b.usdc + 1e-7 < usd) {
        failLog()
        setErr(`You have ${fmtUsd(b.usdc, { maximumFractionDigits: 2 })} USDC, but this needs ${fmtUsd(usd)}.`)
        return
      }
      await contributeOnChain(usd, 'crypto')
    } catch (e) {
      failLog()
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={close} dismissible={!busy || step === 'done'}>
      <AnimatePresence mode="wait" initial={false}>
        {step === 'form' && (
          <motion.div key="form" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}>
            <h2 className="font-display text-[22px] font-bold">Chip in</h2>
            <p className="mt-1 text-[14px] text-ink-2">
              {remaining > 0 ? `${fmtUsd(remaining)} to go.` : 'Goal reached, extra is welcome.'}
            </p>

            <div className="mt-4 flex gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(String(p))}
                  className={cx(
                    'font-display h-11 flex-1 rounded-2xl text-[15px] font-bold transition-colors',
                    Number(amount) === p ? 'bg-ink text-white' : 'bg-white shadow-card hover:bg-black/5',
                  )}
                >
                  ${p}
                </button>
              ))}
            </div>
            <div className="relative mt-3">
              <span className="font-display absolute top-1/2 left-4 -translate-y-1/2 text-[20px] font-bold">$</span>
              <input
                className={cx(inputCls, 'font-display h-16 pl-10 text-[28px] font-bold tabular')}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0"
              />
              {rate && usd > 0 && (
                <span className="absolute top-1/2 right-4 -translate-y-1/2 text-[13px] text-muted">
                  ≈ {fmtTry(usd * rate)}
                </span>
              )}
            </div>

            <input
              className={cx(inputCls, 'mt-3')}
              placeholder="Your name (shown on the list)"
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
            />

            <div className="mt-4 grid grid-cols-2 gap-2">
              <MethodCard
                active={method === 'bank'}
                onClick={() => setMethod('bank')}
                title="Bank transfer"
                sub="Turkish lira · IBAN"
                icon="🏦"
              />
              <MethodCard
                active={method === 'crypto'}
                onClick={() => setMethod('crypto')}
                title="Crypto"
                sub={usdcBalance != null ? `USDC · you have ${fmtUsd(usdcBalance, { maximumFractionDigits: 2 })}` : 'USDC on Stellar'}
                icon="◆"
              />
            </div>

            <Button
              size="lg"
              full
              className="mt-4"
              disabled={!valid}
              onClick={method === 'bank' ? startBank : startCrypto}
            >
              {method === 'bank' ? `Pay ${usd > 0 ? fmtUsd(usd) : ''} by bank transfer` : `Pay ${usd > 0 ? fmtUsd(usd) : ''} in USDC`}
            </Button>
          </motion.div>
        )}

        {(step === 'bank' || step === 'crypto') && (
          <motion.div key="progress" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}>
            <h2 className="font-display text-[22px] font-bold">
              {step === 'bank' ? 'Bank transfer' : 'Paying in USDC'}
            </h2>
            <StepLog lines={log} />

            {step === 'bank' && bank && !txHash && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 rounded-2xl bg-white p-4 shadow-card"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-display text-[15px] font-bold">Send {fmtTry(tryAmount ?? 0)}</span>
                  <Pill tone="outline">Simulated bank</Pill>
                </div>
                <dl className="space-y-2 text-[14px]">
                  <Row k="Bank" v={bank.bankName ?? 'TR Mock Bank'} />
                  <Row k="IBAN" v={bank.iban ?? '—'} mono />
                  <Row k="Description" v={bank.reference ?? '—'} mono />
                </dl>
                <p className="mt-3 text-[12px] text-muted">
                  In real life you'd send this from your banking app. This sandbox has no real bank, so
                  the button below plays the bank for you.
                </p>
                <Button full variant="accent" size="lg" className="mt-3" onClick={simulateBank} loading={busy}>
                  I sent the transfer
                </Button>
              </motion.div>
            )}

            {err && (
              <div className="mt-4 space-y-3">
                <p className="text-[14px] text-[#D33]">{err}</p>
                <Button full variant="ghost" onClick={reset}>
                  Back
                </Button>
              </div>
            )}
          </motion.div>
        )}

        {step === 'done' && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="py-4 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.1 }}
              className="mx-auto flex size-20 items-center justify-center rounded-full bg-accent text-[36px]"
            >
              {view.pool.emoji}
            </motion.div>
            <h2 className="font-display mt-4 text-[24px] font-bold">You're in!</h2>
            <p className="mt-1 text-[14px] text-ink-2">
              {fmtUsd(usd)} added to “{view.pool.title}”.
            </p>
            {txHash && (
              <a
                href={explorerTx(txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-[13px] text-muted underline decoration-line-2 underline-offset-2"
              >
                View on Stellar
              </a>
            )}
            <Button full size="lg" className="mt-6" onClick={close}>
              Done
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  )
}

function defaultAmount(remaining: number) {
  if (remaining <= 0) return '25'
  if (remaining <= 100 && Number.isInteger(remaining)) return String(remaining)
  return '25'
}

function statusLabel(s: string) {
  return (
    {
      pending_user_transfer_start: 'waiting for the bank',
      pending_anchor: '₺ received, converting to USDC',
      pending_trust: 'waiting for USDC trustline',
      pending_stellar: 'sending USDC on Stellar',
      completed: 'done',
    }[s] ?? s.replaceAll('_', ' ')
  )
}

function MethodCard({
  active,
  onClick,
  title,
  sub,
  icon,
}: {
  active: boolean
  onClick: () => void
  title: string
  sub: string
  icon: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'rounded-2xl p-3 text-left transition-all',
        active ? 'bg-ink text-white' : 'bg-white shadow-card hover:bg-black/5',
      )}
    >
      <div className="text-[20px]">{icon}</div>
      <div className="font-display mt-1 text-[14px] font-bold">{title}</div>
      <div className={cx('text-[12px]', active ? 'text-white/70' : 'text-muted')}>{sub}</div>
    </button>
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

export function StepLog({ lines }: { lines: LogLine[] }) {
  return (
    <ol className="mt-4 space-y-2.5">
      <AnimatePresence initial={false}>
        {lines.map((l) => (
          <motion.li
            key={l.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 text-[14px]"
          >
            <span
              className={cx(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                l.state === 'done' && 'bg-ink text-white',
                l.state === 'active' && 'bg-accent text-on-accent',
                l.state === 'error' && 'bg-[#FF3D3D] text-white',
              )}
            >
              {l.state === 'done' ? '✓' : l.state === 'error' ? '!' : <span className="size-2 animate-pulse rounded-full bg-current" />}
            </span>
            <span>
              <span className={cx('font-semibold', l.state === 'active' && 'text-ink', l.state === 'done' && 'text-ink-2')}>
                {l.text}
              </span>
              {l.sub && <span className="block text-[12px] text-muted">{l.sub}</span>}
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}
