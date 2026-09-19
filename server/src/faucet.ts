/**
 * Demo faucet: pays test USDC from a treasury account so the live demo does
 * not depend on the anchor's payout queue for the crypto contributor.
 * Enabled only when DEMO_TREASURY_SECRET is set. Testnet only.
 */
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import deployment from '../../deployments/testnet.json' with { type: 'json' }

const MAX_USD = 200
const horizon = new Horizon.Server(deployment.horizonUrl)
const USDC = new Asset(deployment.usdc.code, deployment.usdc.issuer)
const secret = process.env.DEMO_TREASURY_SECRET
const treasury = secret ? Keypair.fromSecret(secret) : null

export const faucetEnabled = () => treasury !== null
export const faucetAddress = () => treasury?.publicKey() ?? null

export async function faucetBalance(): Promise<number> {
  if (!treasury) return 0
  const acc = await horizon.loadAccount(treasury.publicKey())
  const b = acc.balances.find(
    (x) => x.asset_type !== 'native' && 'asset_code' in x && x.asset_code === USDC.code && x.asset_issuer === USDC.issuer,
  )
  return b ? Number(b.balance) : 0
}

export async function faucetPay(address: string, usd: number): Promise<string> {
  if (!treasury) throw new Error('faucet disabled')
  if (!(usd > 0 && usd <= MAX_USD)) throw new Error(`amount must be 0 < usd ≤ ${MAX_USD}`)
  if (!/^G[A-Z2-7]{55}$/.test(address)) throw new Error('bad address')
  const dest = await horizon.loadAccount(address)
  const trust = dest.balances.some(
    (x) => x.asset_type !== 'native' && 'asset_code' in x && x.asset_code === USDC.code && x.asset_issuer === USDC.issuer,
  )
  if (!trust) throw new Error('destination has no USDC trustline')
  const src = await horizon.loadAccount(treasury.publicKey())
  const tx = new TransactionBuilder(src, {
    fee: (Number(BASE_FEE) * 10).toString(),
    networkPassphrase: deployment.networkPassphrase as typeof Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: address, asset: USDC, amount: usd.toFixed(7) }))
    .setTimeout(60)
    .build()
  tx.sign(treasury)
  const res = await horizon.submitTransaction(tx)
  return res.hash
}
