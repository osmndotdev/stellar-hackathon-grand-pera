/** Client for the server's demo faucet (see server/src/faucet.ts). */
export interface FaucetInfo {
  enabled: boolean
  address: string | null
  balance: number | null
}

export async function faucetInfo(): Promise<FaucetInfo> {
  try {
    const r = await fetch('/api/faucet', { headers: { accept: 'application/json' } })
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { enabled: false, address: null, balance: null }
    return (await r.json()) as FaucetInfo
  } catch {
    return { enabled: false, address: null, balance: null }
  }
}

export async function faucetPay(address: string, usd: number): Promise<string> {
  const r = await fetch('/api/faucet', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ address, usd }),
  })
  const j = (await r.json()) as { hash?: string; error?: string }
  if (!r.ok || !j.hash) throw new Error(j.error ?? 'faucet failed')
  return j.hash
}
