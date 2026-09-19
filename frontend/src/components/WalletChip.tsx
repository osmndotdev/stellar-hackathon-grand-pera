import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { explorerAccount } from '@/lib/config'
import { fmtUsd } from '@/lib/money'
import { Sheet } from './Sheet'
import { Button, Pill, shortAddr } from './ui'

export function WalletChip() {
  const { signer, balances, connectExternal, useInstant, refresh } = useWallet()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const connect = async () => {
    setBusy(true)
    setErr(null)
    try {
      await connectExternal()
      setOpen(false)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setOpen(true)
          refresh()
        }}
        className="flex h-9 items-center gap-2 rounded-pill border border-line-2 bg-white pl-1.5 pr-3 text-[13px] font-semibold"
      >
        <span className="size-6 rounded-full bg-accent" aria-hidden />
        {signer.kind === 'kit' ? 'Wallet' : 'You'}
        <span className="text-muted">{shortAddr(signer.address)}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Your account">
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 shadow-card">
            <div className="mb-1 flex items-center gap-2">
              <Pill tone={signer.kind === 'kit' ? 'ink' : 'accent'}>
                {signer.kind === 'kit' ? 'External wallet' : 'Instant account'}
              </Pill>
            </div>
            <a
              href={explorerAccount(signer.address)}
              target="_blank"
              rel="noreferrer"
              className="block break-all font-mono text-[12px] text-ink-2 underline decoration-line-2 underline-offset-2"
            >
              {signer.address}
            </a>
            <div className="mt-3 flex gap-4 text-[14px]">
              <div>
                <div className="text-[12px] text-muted">USDC</div>
                <div className="tabular font-semibold">{balances ? fmtUsd(balances.usdc, { maximumFractionDigits: 2 }) : '—'}</div>
              </div>
              <div>
                <div className="text-[12px] text-muted">XLM</div>
                <div className="tabular font-semibold">{balances ? balances.xlm.toFixed(1) : '—'}</div>
              </div>
            </div>
            {signer.kind === 'instant' && (
              <p className="mt-3 text-[12px] text-muted">
                Plink made this Stellar account for you in this browser. No app to install.
              </p>
            )}
          </div>
          {signer.kind === 'instant' ? (
            <Button full variant="ghost" onClick={connect} loading={busy}>
              Connect a Stellar wallet instead
            </Button>
          ) : (
            <Button full variant="ghost" onClick={() => useInstant().then(() => setOpen(false))}>
              Switch back to instant account
            </Button>
          )}
          {err && <p className="text-[13px] text-[#D33]">{err}</p>}
          <Link to="/demo" className="block text-center text-[13px] text-muted underline" onClick={() => setOpen(false)}>
            Demo control panel
          </Link>
        </div>
      </Sheet>
    </>
  )
}
