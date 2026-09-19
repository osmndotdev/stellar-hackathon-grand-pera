import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import * as anchor from '@/lib/anchor'
import { explorerTx } from '@/lib/config'
import { friendlyError } from '@/lib/errors'
import { fmtTry, fmtUsd, fromUsdc } from '@/lib/money'
import { addPending, usePending, usePendingStatus } from '@/lib/pending'
import type { PoolView } from '@/lib/pool'
import { getBalances, writeClient } from '@/lib/stellar'
import { getSavedName, saveName } from '@/lib/wallet'
import { PendingDepositCard } from './PendingDeposit'
import { Sheet } from './Sheet'
import { Button, cx, inputCls } from './ui'

type Method = 'bank' | 'crypto'
type Step = 'form' | 'bank' | 'crypto' | 'done'

export interface LogLine {
  key: string
  text: string
  state: 'active' | 'done' | 'error'
  sub?: string
}

const PRESETS = [10, 25, 50, 100]
/** The TR Mock Anchor caps a single deposit at ₺3000; stay under it. */
const MAX_BANK_TRY = 3000

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
  const [orderId, setOrderId] = useState<string | null>(null)
  const [rate, setRate] = useState<number | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)

  const pendingHere = usePending(view.pool.id, signer.address)
  const myOrder = pendingHere.find((p) => p.orderId === orderId) ?? null
  const orderStatus = usePendingStatus(orderId)

  const usd = Number(amount)
  const maxBankUsd = rate ? Math.floor((MAX_BANK_TRY / rate) * 100) / 100 : null
  const bankTooBig = method === 'bank' && maxBankUsd != null && usd > maxBankUsd
  const valid = usd > 0 && name.trim().length > 0 && !bankTooBig

  useEffect(() => {
    if (!open) return
    anchor
      .priceTryToUsdc(1000)
      .then((p) => setRate(p.tryPerUsdc))
      .catch(() => {})
    getBalances(signer.address)
      .then((b) => setUsdcBalance(b.usdc))
      .catch(() => {})
  }, [open, signer.address])

  const reset = () => {
    setStep('form')
    setLog([])
    setOrderId(null)
    setTxHash(null)
    setErr(null)
    setBusy(false)
  }
  const close = () => {
    if (busy) return
    onClose()
    setTimeout(reset, 300)
  }

  const push = (key: string, text: string, sub?: string) =>
    setLog((l) => [...l.map((x) => (x.state === 'active' ? { ...x, state: 'done' as const } : x)), { key, text, sub, state: 'active' }])
  const finishLog = () => setLog((l) => l.map((x) => (x.state === 'active' ? { ...x, state: 'done' } : x)))
  const failLog = () => setLog((l) => l.map((x) => (x.state === 'active' ? { ...x, state: 'error' } : x)))

  // ---- bank: create the order, then hand over to the shared resolver.
  const startBank = async () => {
    setBusy(true)
    setErr(null)
    setStep('bank')
    try {
      saveName(name.trim())
      push('prep', 'Preparing your Stellar account')
      await ensureReady()
      push('auth', 'Logging in to the anchor', 'SEP-10, signed with your key')
      await anchor.authenticate(signer)
      push('quote', 'Locking today’s ₺ rate', 'SEP-38')
      const p = await anchor.priceTryToUsdc(1000)
      // One extra kuruş so rounding never leaves the USDC a hair short.
      const tr = Math.ceil(usd * p.tryPerUsdc * 100 + 1) / 100
      setRate(p.tryPerUsdc)
      push('order', 'Creating your bank transfer', 'SEP-6 deposit')
      const order = await anchor.startDeposit(signer, tr)
      finishLog()
      addPending({
        orderId: order.id,
        poolId: view.pool.id,
        address: signer.address,
        usd,
        tryAmount: tr,
        name: name.trim(),
        iban: order.iban,
        reference: order.reference,
        bankName: order.bankName,
        createdAt: Date.now(),
      })
      setOrderId(order.id)
    } catch (e) {
      failLog()
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  // ---- crypto: straight to the contract.
  const startCrypto = async () => {
    setBusy(true)
    setErr(null)
    setStep('crypto')
    try {
      saveName(name.trim())
      push('prep', 'Checking your account')
      await ensureReady()
      const b = await getBalances(signer.address)
      setUsdcBalance(b.usdc)
      if (b.usdc + 1e-7 < usd) {
        failLog()
        setErr(`You have ${fmtUsd(b.usdc, { maximumFractionDigits: 2 })} USDC, but this needs ${fmtUsd(usd)}.`)
        return
      }
      push('chain', 'Adding to the pool on Stellar')
      const tx = await writeClient(signer).contribute({
        id: view.pool.id,
        from: signer.address,
        amount: fromUsdc(usd),
        name: name.trim(),
        method: 'crypto',
      })
      const sent = await tx.signAndSend()
      setTxHash(sent.sendTransactionResponse?.hash ?? null)
      finishLog()
      setStep('done')
      onContributed()
      refresh()
    } catch (e) {
      failLog()
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const bankDone = orderStatus?.stage === 'done'

  return (
    <Sheet open={open} onClose={close} dismissible={!busy}>
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

            {bankTooBig && maxBankUsd != null && (
              <p className="mt-3 text-[13px] text-[#D33]">
                The anchor takes at most {fmtTry(MAX_BANK_TRY)} per transfer (about {fmtUsd(maxBankUsd)}). Split it, or
                pay the rest in USDC.
              </p>
            )}
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

        {step === 'bank' && (
          <motion.div key="bank" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}>
            {!myOrder && !bankDone && (
              <>
                <h2 className="font-display text-[22px] font-bold">Bank transfer</h2>
                <StepLog lines={log} />
              </>
            )}
            {myOrder && (
              <PendingDepositCard
                pending={myOrder}
                onContributed={() => {
                  onContributed()
                  refresh()
                }}
              />
            )}
            {bankDone && <DoneCard emoji={view.pool.emoji} usd={usd} title={view.pool.title} txHash={orderStatus?.txHash ?? null} onClose={close} />}
            {err && (
              <div className="mt-4 space-y-3">
                <p className="text-[14px] text-[#D33]">{err}</p>
                <Button full variant="ghost" onClick={reset}>
                  Back
                </Button>
              </div>
            )}
            {myOrder && !bankDone && (
              <Button full variant="ghost" className="mt-3" onClick={close}>
                Close, finish in the background
              </Button>
            )}
          </motion.div>
        )}

        {step === 'crypto' && (
          <motion.div key="crypto" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}>
            <h2 className="font-display text-[22px] font-bold">Paying in USDC</h2>
            <StepLog lines={log} />
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
          <DoneCard key="done" emoji={view.pool.emoji} usd={usd} title={view.pool.title} txHash={txHash} onClose={close} />
        )}
      </AnimatePresence>
    </Sheet>
  )
}

function DoneCard({
  emoji,
  usd,
  title,
  txHash,
  onClose,
}: {
  emoji: string
  usd: number
  title: string
  txHash: string | null
  onClose: () => void
}) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="py-4 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.1 }}
        className="mx-auto flex size-20 items-center justify-center rounded-full bg-accent text-[36px]"
      >
        {emoji}
      </motion.div>
      <h2 className="font-display mt-4 text-[24px] font-bold">You're in!</h2>
      <p className="mt-1 text-[14px] text-ink-2">
        {fmtUsd(usd)} added to “{title}”.
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
      <Button full size="lg" className="mt-6" onClick={onClose}>
        Done
      </Button>
    </motion.div>
  )
}

function defaultAmount(remaining: number) {
  if (remaining <= 0) return '25'
  if (remaining <= 100 && Number.isInteger(remaining)) return String(remaining)
  return '25'
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
