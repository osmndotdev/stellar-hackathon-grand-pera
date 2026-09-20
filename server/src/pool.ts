import { contract } from '@stellar/stellar-sdk'
import deployment from '../../deployments/testnet.json' with { type: 'json' }

interface Pool {
  id: number
  organizer: string
  title: string
  emoji: string
  target: bigint
  raised: bigint
  deadline: bigint
  claimed: boolean
}

export interface PoolSummary {
  title: string
  emoji: string
  organizer: string
  raised: string
  target: string
  status: string
}

let clientPromise: Promise<contract.Client> | null = null
function client() {
  // Client.from pulls the contract spec from the network, so no bindings needed.
  clientPromise ??= contract.Client.from({
    contractId: deployment.contractId,
    networkPassphrase: deployment.networkPassphrase,
    rpcUrl: deployment.rpcUrl,
  })
  return clientPromise
}

const cache = new Map<number, { at: number; value: PoolSummary | null }>()
const TTL_MS = 10_000

const usd = (base: bigint) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    Number(base) / 1e7,
  )

export async function getPoolSummary(id: number): Promise<PoolSummary | null> {
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const c = (await client()) as contract.Client & {
    get_pool: (a: { id: number }) => Promise<contract.AssembledTransaction<contract.Result<Pool>>>
  }
  const tx = await c.get_pool({ id })
  let value: PoolSummary | null = null
  if (tx.result.isOk()) {
    const p = tx.result.unwrap()
    const now = BigInt(Math.floor(Date.now() / 1000))
    const status = p.claimed
      ? 'claimed'
      : p.raised >= p.target
        ? 'target reached'
        : now > p.deadline
          ? 'ended'
          : 'open'
    value = { title: p.title, emoji: p.emoji, organizer: p.organizer, raised: usd(p.raised), target: usd(p.target), status }
  }
  cache.set(id, { at: Date.now(), value })
  return value
}
