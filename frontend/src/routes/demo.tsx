import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { Pool } from '../contract-client'
import { StepLog } from '@/components/ContributeSheet'
import { Button, Card, Pill, inputCls, shortAddr } from '@/components/ui'
import { useWallet } from '@/hooks/useWallet'
import * as anchor from '@/lib/anchor'
import { CONTRACT_ID, explorerContract } from '@/lib/config'
import { fmtBase, fmtUsd } from '@/lib/money'
import { fetchPools, statusOf } from '@/lib/pool'
import { getBalances } from '@/lib/stellar'

export const Route = createFileRoute('/demo')({
  component: DemoPage,
})

type Line = { key: string; text: string; state: 'active' | 'done' | 'error'; sub?: string }

/**
 * Demo control panel. Everything here is a convenience for the live demo;
 * nothing bypasses the contract rules.
 */
function DemoPage() {
  const { signer, balances, refresh, ensureReady, resetInstant } = useWallet()
  const [pools, setPools] = useState<Pool[] | null>(null)
  const [topup, setTopup] = useState('100')
  const [log, setLog] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadPools = () => fetchPools(0, 50).then(setPools).catch(() => setPools([]))
  useEffect(() => {
    loadPools()
  }, [])

  const push = (key: string, text: string, sub?: string) =>
    setLog((l) => [...l.map((x) => (x.state === 'active' ? { ...x, state: 'done' as const } : x)), { key, text, sub, state: 'active' }])

  /** Gets test USDC the honest way: a TRY deposit through the anchor. */
  const doTopup = async () => {
    const usd = Number(topup)
    if (!(usd > 0)) return
    setBusy(true)
    setErr(null)
    setLog([])
    try {
      push('prep', 'Preparing account (friendbot + USDC trustline)')
      await ensureReady()
      push('auth', 'SEP-10 login')
      await anchor.authenticate(signer)
      push('quote', 'SEP-38 price')
      const p = await anchor.priceTryToUsdc(1000)
      const tr = Math.ceil(usd * p.tryPerUsdc * 100 + 1) / 100
      push('dep', `SEP-6 deposit of ₺${tr}`)
      const order = await anchor.startDeposit(signer, tr)
      push('sim', 'Simulating the bank transfer')
      await anchor.simulateBankTransfer(signer, order.id, tr)
      push('wait', 'Waiting for USDC')
      const done = await anchor.waitForStatus(signer, order.id, (t) =>
        setLog((l) => l.map((x) => (x.key === 'wait' ? { ...x, sub: t.status } : x))),
      )
      if (done.status !== 'completed') throw new Error(done.message ?? done.status)
      setLog((l) => l.map((x) => ({ ...x, state: 'done' })))
      await refresh()
    } catch (e) {
      setLog((l) => l.map((x) => (x.state === 'active' ? { ...x, state: 'error' } : x)))
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 pt-1">
      <div>
        <h1 className="font-display text-[26px] font-extrabold">Demo panel</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          Helpers for the live demo. Nothing here bypasses the contract.
        </p>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[15px] font-bold">This browser's account</h2>
          <Pill tone={signer.kind === 'kit' ? 'ink' : 'accent'}>{signer.kind}</Pill>
        </div>
        <div className="font-mono text-[12px] break-all text-ink-2">{signer.address}</div>
        <div className="flex gap-4 text-[14px]">
          <span>
            USDC <b className="tabular">{balances ? fmtUsd(balances.usdc, { maximumFractionDigits: 2 }) : '—'}</b>
          </span>
          <span>
            XLM <b className="tabular">{balances ? balances.xlm.toFixed(1) : '—'}</b>
          </span>
          <button className="text-muted underline" onClick={refresh}>
            refresh
          </button>
        </div>
        <div className="flex gap-2">
          <input className={inputCls} inputMode="decimal" value={topup} onChange={(e) => setTopup(e.target.value)} />
          <Button onClick={doTopup} loading={busy} className="shrink-0">
            Get ${topup || '0'} USDC via anchor
          </Button>
        </div>
        {log.length > 0 && <StepLog lines={log} />}
        {err && <p className="text-[13px] text-[#D33]">{err}</p>}
        {signer.kind === 'instant' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm('Forget this instant account and make a new one?')) {
                resetInstant()
                setTimeout(() => getBalances(signer.address).catch(() => {}), 0)
              }
            }}
          >
            Reset instant account
          </Button>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-[15px] font-bold">All pools</h2>
          <button className="text-[13px] text-muted underline" onClick={loadPools}>
            refresh
          </button>
        </div>
        <ul className="divide-y divide-line">
          {pools?.map((p) => {
            const s = statusOf(p)
            return (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span className="text-[20px]">{p.emoji}</span>
                <div className="min-w-0 flex-1">
                  <Link to="/p/$id" params={{ id: String(p.id) }} search={{}} className="block truncate text-[14px] font-semibold">
                    #{p.id} {p.title}
                  </Link>
                  <div className="text-[12px] text-muted">
                    {fmtBase(p.raised)} / {fmtBase(p.target)} · {p.organizer} · {shortAddr(p.creator)}
                  </div>
                </div>
                <Pill tone={s === 'funded' ? 'accent' : s === 'claimed' ? 'ink' : 'soft'}>{s}</Pill>
              </li>
            )
          })}
          {pools && pools.length === 0 && <li className="py-3 text-[14px] text-muted">No pools yet.</li>}
        </ul>
      </Card>

      <p className="text-[12px] text-muted">
        Contract{' '}
        <a className="underline" href={explorerContract(CONTRACT_ID)} target="_blank" rel="noreferrer">
          {shortAddr(CONTRACT_ID)}
        </a>{' '}
        on Stellar testnet. Seed demo pools with <code>just seed</code>.
      </p>
    </div>
  )
}
