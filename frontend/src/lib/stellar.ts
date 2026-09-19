import { Asset, Horizon, NotFoundError, Operation, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk'
import { Server as RpcServer } from '@stellar/stellar-sdk/rpc'
import { Client as PlinkClient } from '../contract-client'
import {
  CONTRACT_ID,
  FRIENDBOT_URL,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  RPC_URL,
  USDC_CODE,
  USDC_ISSUER,
} from './config'
import type { Signer } from './signer-keypair'

export const rpc = new RpcServer(RPC_URL)
export const horizon = new Horizon.Server(HORIZON_URL)
export const USDC = new Asset(USDC_CODE, USDC_ISSUER)

/** Read-only client (simulations only). */
export const readClient = new PlinkClient({
  contractId: CONTRACT_ID,
  networkPassphrase: NETWORK_PASSPHRASE,
  rpcUrl: RPC_URL,
})

/** Client that can sign and send as `signer`. */
export function writeClient(signer: Signer) {
  return new PlinkClient({
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: signer.address,
    signTransaction: signer.signTransaction,
  })
}

export interface Balances {
  exists: boolean
  xlm: number
  usdc: number
  hasUsdcTrustline: boolean
}

export async function getBalances(address: string): Promise<Balances> {
  try {
    const acc = await horizon.loadAccount(address)
    let xlm = 0
    let usdc = 0
    let hasUsdcTrustline = false
    for (const b of acc.balances) {
      if (b.asset_type === 'native') xlm = Number(b.balance)
      else if (
        (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
        b.asset_code === USDC_CODE &&
        b.asset_issuer === USDC_ISSUER
      ) {
        usdc = Number(b.balance)
        hasUsdcTrustline = true
      }
    }
    return { exists: true, xlm, usdc, hasUsdcTrustline }
  } catch (e) {
    if (e instanceof NotFoundError || (e as { response?: { status?: number } })?.response?.status === 404) {
      return { exists: false, xlm: 0, usdc: 0, hasUsdcTrustline: false }
    }
    throw e
  }
}

/** Create + fund the account on testnet via friendbot if it doesn't exist yet. */
export async function ensureFunded(address: string): Promise<void> {
  const b = await getBalances(address)
  if (b.exists) return
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`)
  if (!res.ok && res.status !== 400) {
    throw new Error(`Friendbot failed (${res.status})`)
  }
  // 400 usually means "already funded" (race with another tab).
}

/** Open a USDC trustline if missing. Signs with `signer` (tx source = signer). */
export async function ensureUsdcTrustline(signer: Signer): Promise<void> {
  const b = await getBalances(signer.address)
  if (b.hasUsdcTrustline) return
  const account = await horizon.loadAccount(signer.address)
  const tx = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 10).toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build()
  const { signedTxXdr } = await signer.signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  })
  await horizon.submitTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE))
}

/** Classic USDC payment (used for anchor withdrawals and demo top-ups). */
export async function payUsdc(
  signer: Signer,
  destination: string,
  amount: string,
  memoId?: string,
): Promise<string> {
  const { Memo } = await import('@stellar/stellar-sdk')
  const account = await horizon.loadAccount(signer.address)
  const builder = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 10).toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination, asset: USDC, amount }))
    .setTimeout(60)
  if (memoId) builder.addMemo(Memo.id(memoId))
  const tx = builder.build()
  const { signedTxXdr } = await signer.signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  })
  const res = await horizon.submitTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE),
  )
  return res.hash
}

/** Prepare an instant wallet for use: funded and trusting USDC. */
export async function prepareAccount(signer: Signer): Promise<void> {
  await ensureFunded(signer.address)
  await ensureUsdcTrustline(signer)
}
