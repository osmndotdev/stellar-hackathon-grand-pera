import type { Contribution, Pool } from '../contract-client'
import { readClient } from './stellar'

export type PoolStatus = 'open' | 'funded' | 'claimed' | 'expired'

export interface PoolView {
  pool: Pool
  contributions: Contribution[]
  status: PoolStatus
}

export const nowSec = () => Math.floor(Date.now() / 1000)

export function statusOf(pool: Pool, now = nowSec()): PoolStatus {
  if (pool.claimed) return 'claimed'
  if (pool.raised >= pool.target) return 'funded'
  if (now > Number(pool.deadline)) return 'expired'
  return 'open'
}

export async function fetchPool(id: number): Promise<PoolView | null> {
  const [p, c] = await Promise.all([
    readClient.get_pool({ id }),
    readClient.get_contributions({ id }),
  ])
  if (p.result.isErr()) return null
  const pool = p.result.unwrap()
  const contributions = [...c.result].filter((x) => !x.refunded && x.amount > 0n)
  contributions.sort((a, b) => Number(b.at - a.at))
  return { pool, contributions, status: statusOf(pool) }
}

export async function fetchPools(from = 0, limit = 50): Promise<Pool[]> {
  const r = await readClient.list_pools({ from, limit })
  return [...r.result].reverse()
}

export async function fetchContribution(id: number, contributor: string): Promise<Contribution | null> {
  const r = await readClient.get_contribution({ id, contributor })
  return r.result ?? null
}
