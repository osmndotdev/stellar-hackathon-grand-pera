/**
 * Pending bank deposits. A fiat contribution is only "in" once the anchor has
 * delivered USDC and the contract call succeeded. Until then we remember the
 * order in localStorage and finish it whenever the money lands, even after a
 * reload or with the sheet closed. Real bank transfers take a while; the
 * sandbox sometimes does too.
 */
import { useSyncExternalStore } from 'react'
import * as anchor from './anchor'
import { fromUsdc } from './money'
import type { Signer } from './signer-keypair'
import { getBalances, writeClient } from './stellar'

export interface PendingDeposit {
  orderId: string
  poolId: number
  address: string
  usd: number
  tryAmount: number
  name: string
  iban?: string
  reference?: string
  bankName?: string
  createdAt: number
}

export type Stage = 'bank' | 'anchor' | 'landed' | 'contributing' | 'done' | 'error'
export interface PendingStatus {
  stage: Stage
  anchorStatus?: string
  txHash?: string
  error?: string
}

const LS_KEY = 'plink.pending'

// ---------------------------------------------------------------- storage

function readAll(): PendingDeposit[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
  } catch {
    return []
  }
}
function writeAll(list: PendingDeposit[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
  notify()
}

let snapshot: PendingDeposit[] = readAll()
const listeners = new Set<() => void>()
const notify = () => {
  snapshot = readAll()
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function addPending(p: PendingDeposit) {
  writeAll([...readAll().filter((x) => x.orderId !== p.orderId), p])
}
export function removePending(orderId: string) {
  writeAll(readAll().filter((x) => x.orderId !== orderId))
}
export function usePending(poolId: number, address: string): PendingDeposit[] {
  const all = useSyncExternalStore(subscribe, () => snapshot)
  return all.filter((p) => p.poolId === poolId && p.address === address)
}

// ---------------------------------------------------------------- status

const statuses = new Map<string, PendingStatus>()
const statusListeners = new Set<() => void>()
function setStatus(orderId: string, s: PendingStatus) {
  statuses.set(orderId, s)
  statusListeners.forEach((l) => l())
}
const subscribeStatus = (l: () => void) => {
  statusListeners.add(l)
  return () => statusListeners.delete(l)
}
export function usePendingStatus(orderId: string | null): PendingStatus | undefined {
  return useSyncExternalStore(subscribeStatus, () => (orderId ? statuses.get(orderId) : undefined))
}

// ---------------------------------------------------------------- resolver

const inFlight = new Set<string>()

/** Sandbox only: play the bank. Safe to call from the sheet or the banner. */
export async function markSent(p: PendingDeposit, signer: Signer) {
  await anchor.simulateBankTransfer(signer, p.orderId, p.tryAmount)
  setStatus(p.orderId, { stage: 'anchor', anchorStatus: 'pending_anchor' })
}

/**
 * Drive one pending deposit to completion. Idempotent per page: a second call
 * for the same order while one is running is a no-op. Resolves when done or
 * failed; the status store carries the details.
 */
export async function resolvePending(
  p: PendingDeposit,
  signer: Signer,
  onContributed: () => void,
): Promise<void> {
  if (inFlight.has(p.orderId) || signer.address !== p.address) return
  inFlight.add(p.orderId)
  try {
    const first = await anchor.getTransaction(signer, p.orderId)
    if (first.status === 'pending_user_transfer_start') {
      setStatus(p.orderId, { stage: 'bank', anchorStatus: first.status })
    } else {
      setStatus(p.orderId, { stage: 'anchor', anchorStatus: first.status })
    }
    const done = await anchor.waitForStatus(
      signer,
      p.orderId,
      (t) => {
        if (t.status === 'pending_user_transfer_start') setStatus(p.orderId, { stage: 'bank', anchorStatus: t.status })
        else if (t.status !== 'completed') setStatus(p.orderId, { stage: 'anchor', anchorStatus: t.status })
      },
      { timeoutMs: 20 * 60_000 },
    )
    if (done.status !== 'completed') throw new Error(done.message ?? `Anchor status: ${done.status}`)
    setStatus(p.orderId, { stage: 'landed' })
    const b = await getBalances(signer.address)
    const give = Math.min(p.usd, Math.floor(b.usdc * 1e7) / 1e7)
    if (give <= 0) throw new Error('USDC has not arrived in your account yet')
    setStatus(p.orderId, { stage: 'contributing' })
    const tx = await writeClient(signer).contribute({
      id: p.poolId,
      from: signer.address,
      amount: fromUsdc(give),
      name: p.name,
      method: 'bank',
    })
    const sent = await tx.signAndSend()
    setStatus(p.orderId, { stage: 'done', txHash: sent.sendTransactionResponse?.hash })
    removePending(p.orderId)
    onContributed()
  } catch (e) {
    setStatus(p.orderId, { stage: 'error', error: (e as Error).message })
  } finally {
    inFlight.delete(p.orderId)
  }
}
