import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getBalances, prepareAccount, type Balances } from '@/lib/stellar'
import {
  connectKit,
  disconnectKit,
  importInstantSecret,
  instantSigner,
  resetInstantWallet,
  restoreKit,
  type Signer,
} from '@/lib/wallet'

interface WalletCtx {
  signer: Signer
  balances: Balances | null
  refresh: () => Promise<void>
  /** Funds + opens USDC trustline for the instant wallet. No-op for kit wallets. */
  ensureReady: () => Promise<void>
  preparing: boolean
  connectExternal: () => Promise<void>
  useInstant: () => Promise<void>
  resetInstant: () => void
  importSecret: (secret: string) => Promise<void>
}

const Ctx = createContext<WalletCtx | null>(null)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [signer, setSigner] = useState<Signer>(() => instantSigner())
  const [balances, setBalances] = useState<Balances | null>(null)
  const [preparing, setPreparing] = useState(false)
  const prepared = useRef<Set<string>>(new Set())

  useEffect(() => {
    restoreKit().then((s) => s && setSigner(s))
  }, [])

  const refresh = useCallback(async () => {
    try {
      setBalances(await getBalances(signer.address))
    } catch {
      /* transient */
    }
  }, [signer.address])

  useEffect(() => {
    refresh()
  }, [refresh])

  const ensureReady = useCallback(async () => {
    if (signer.kind !== 'instant') return
    if (prepared.current.has(signer.address)) return
    setPreparing(true)
    try {
      await prepareAccount(signer)
      prepared.current.add(signer.address)
      await refresh()
    } finally {
      setPreparing(false)
    }
  }, [signer, refresh])

  const connectExternal = useCallback(async () => {
    const s = await connectKit()
    setSigner(s)
  }, [])

  const useInstant = useCallback(async () => {
    await disconnectKit()
    setSigner(instantSigner())
  }, [])

  const resetInstant = useCallback(() => {
    resetInstantWallet()
    prepared.current.clear()
    setSigner(instantSigner())
  }, [])

  const importSecret = useCallback(async (secret: string) => {
    importInstantSecret(secret)
    await disconnectKit()
    setSigner(instantSigner())
  }, [])

  const value = useMemo(
    () => ({ signer, balances, refresh, ensureReady, preparing, connectExternal, useInstant, resetInstant, importSecret }),
    [signer, balances, refresh, ensureReady, preparing, connectExternal, useInstant, resetInstant, importSecret],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWallet() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWallet outside WalletProvider')
  return v
}
