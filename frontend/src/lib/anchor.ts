/**
 * TR Mock Anchor integration over the standard SEP door:
 * SEP-1 discovery → SEP-10 auth → SEP-38 price → SEP-6 deposit/withdraw.
 * The bank leg is simulated by the sandbox; the USDC leg is real testnet.
 */
import { ANCHOR_HOME_DOMAIN, USDC_ISSUER } from './config'
import type { Signer } from './signer-keypair'

export interface AnchorEndpoints {
  webAuth: string
  transferServer: string
  quoteServer: string
  kycServer: string
  signingKey: string
}

let endpointsCache: AnchorEndpoints | null = null

/** SEP-1: read stellar.toml from the home domain. */
export async function discover(): Promise<AnchorEndpoints> {
  if (endpointsCache) return endpointsCache
  const res = await fetch(`https://${ANCHOR_HOME_DOMAIN}/.well-known/stellar.toml`)
  if (!res.ok) throw new Error('Could not read the anchor stellar.toml')
  const text = await res.text()
  const pick = (key: string) => {
    const m = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'))
    if (!m) throw new Error(`stellar.toml is missing ${key}`)
    return m[1]
  }
  endpointsCache = {
    webAuth: pick('WEB_AUTH_ENDPOINT'),
    transferServer: pick('TRANSFER_SERVER'),
    quoteServer: pick('ANCHOR_QUOTE_SERVER'),
    kycServer: pick('KYC_SERVER'),
    signingKey: pick('SIGNING_KEY'),
  }
  return endpointsCache
}

const tokenCache = new Map<string, { token: string; exp: number }>()

/** SEP-10: prove control of the address by signing a challenge. Returns a JWT. */
export async function authenticate(signer: Signer): Promise<string> {
  const cached = tokenCache.get(signer.address)
  if (cached && cached.exp > Date.now() + 60_000) return cached.token
  const ep = await discover()
  const chRes = await fetch(`${ep.webAuth}?account=${encodeURIComponent(signer.address)}`)
  if (!chRes.ok) throw new Error('Anchor refused to issue a login challenge')
  const { transaction } = (await chRes.json()) as { transaction: string }
  const signed = await signer.signChallenge(transaction)
  const tokRes = await fetch(ep.webAuth, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signed }),
  })
  if (!tokRes.ok) throw new Error('Anchor rejected the signed challenge')
  const { token } = (await tokRes.json()) as { token: string }
  let exp = Date.now() + 10 * 60_000
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    if (payload.exp) exp = payload.exp * 1000
  } catch {
    /* keep default */
  }
  tokenCache.set(signer.address, { token, exp })
  return token
}

export interface Price {
  /** TRY per 1 USDC including the anchor spread. */
  tryPerUsdc: number
  /** USDC you get for `sellTry`. */
  usdcOut: number
  feeTry: number
}

/** SEP-38: indicative price for TRY → USDC. No auth needed on this endpoint. */
export async function priceTryToUsdc(sellTry: number): Promise<Price> {
  const ep = await discover()
  const q = new URLSearchParams({
    sell_asset: 'iso4217:TRY',
    buy_asset: `stellar:USDC:${USDC_ISSUER}`,
    sell_amount: sellTry.toFixed(2),
    context: 'sep6',
  })
  const res = await fetch(`${ep.quoteServer}/price?${q}`)
  if (!res.ok) throw new Error('Anchor could not quote a price')
  const j = (await res.json()) as { total_price: string; buy_amount: string; fee?: { total: string } }
  return {
    tryPerUsdc: Number(j.total_price),
    usdcOut: Number(j.buy_amount),
    feeTry: Number(j.fee?.total ?? 0),
  }
}

/** SEP-38: indicative price for USDC → TRY (cash-out). */
export async function priceUsdcToTry(sellUsdc: number): Promise<{ tryOut: number; tryPerUsdc: number }> {
  const ep = await discover()
  const q = new URLSearchParams({
    sell_asset: `stellar:USDC:${USDC_ISSUER}`,
    buy_asset: 'iso4217:TRY',
    sell_amount: sellUsdc.toFixed(7),
    context: 'sep6',
  })
  const res = await fetch(`${ep.quoteServer}/price?${q}`)
  if (!res.ok) throw new Error('Anchor could not quote a price')
  const j = (await res.json()) as { total_price: string; buy_amount: string }
  return { tryOut: Number(j.buy_amount), tryPerUsdc: 1 / Number(j.total_price) }
}

export interface DepositOrder {
  id: string
  /** Human instructions from the anchor (IBAN + reference). */
  how: string
  iban?: string
  reference?: string
  bankName?: string
  moreInfoUrl?: string
  eta?: number
}

/** SEP-6: start a TRY deposit that pays USDC to `signer.address`. */
export async function startDeposit(signer: Signer, amountTry: number): Promise<DepositOrder> {
  const ep = await discover()
  const token = await authenticate(signer)
  const q = new URLSearchParams({
    asset_code: 'USDC',
    account: signer.address,
    amount: amountTry.toFixed(2),
    type: 'bank_account',
  })
  const res = await fetch(`${ep.transferServer}/deposit?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const j = await res.json()
  if (!res.ok) throw new Error(j.error ?? 'Anchor could not start the deposit')
  const how: string = j.how ?? ''
  const instr = j.instructions ?? {}
  const iban: string | undefined = instr?.bank_account_number?.value ?? instr?.iban?.value
  const reference: string | undefined = instr?.external_transfer_memo?.value ?? instr?.reference?.value
  const bankName: string | undefined = instr?.bank_name?.value
  return {
    id: String(j.id),
    how,
    iban,
    reference,
    bankName,
    moreInfoUrl: j.more_info_url,
    eta: j.eta,
  }
}

/** Sandbox only: play the bank and mark the TRY as arrived. */
export async function simulateBankTransfer(signer: Signer, orderId: string, amountTry: number) {
  const ep = await discover()
  const token = await authenticate(signer)
  const res = await fetch(`${ep.transferServer}/tx/${orderId}/simulate-bank-transfer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountTry.toFixed(2) }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error ?? 'Simulated bank transfer failed')
  }
}

export interface AnchorTx {
  id: string
  kind: 'deposit' | 'withdrawal'
  status: string
  amountIn?: string
  amountOut?: string
  stellarTxId?: string
  message?: string
}

/** SEP-6: transaction status. */
export async function getTransaction(signer: Signer, id: string): Promise<AnchorTx> {
  const ep = await discover()
  const token = await authenticate(signer)
  const res = await fetch(`${ep.transferServer}/transaction?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Could not read the anchor transaction')
  const { transaction: t } = await res.json()
  return {
    id: String(t.id),
    kind: t.kind,
    status: t.status,
    amountIn: t.amount_in,
    amountOut: t.amount_out,
    stellarTxId: t.stellar_transaction_id ?? undefined,
    message: t.message ?? undefined,
  }
}

/** Poll until the anchor reports a terminal status. */
export async function waitForStatus(
  signer: Signer,
  id: string,
  onUpdate: (tx: AnchorTx) => void,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<AnchorTx> {
  const interval = opts.intervalMs ?? 2500
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000)
  for (;;) {
    const tx = await getTransaction(signer, id)
    onUpdate(tx)
    if (tx.status === 'completed' || tx.status === 'error' || tx.status === 'refunded') return tx
    if (Date.now() > deadline) throw new Error('Anchor took too long; check the transaction later')
    await new Promise((r) => setTimeout(r, interval))
  }
}

export interface WithdrawOrder {
  id: string
  /** Anchor treasury account to pay USDC into. */
  accountId: string
  memo: string
  memoType: string
  /** Sandbox message, includes the simulated IBAN that receives TRY. */
  message?: string
  eta?: number
}

/** SEP-6: start a USDC → TRY withdrawal (cash-out to IBAN, simulated FAST). */
export async function startWithdraw(signer: Signer, amountUsdc: number): Promise<WithdrawOrder> {
  const ep = await discover()
  const token = await authenticate(signer)
  const q = new URLSearchParams({
    asset_code: 'USDC',
    type: 'bank_account',
    amount: amountUsdc.toFixed(7),
    account: signer.address,
  })
  const res = await fetch(`${ep.transferServer}/withdraw?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const j = await res.json()
  if (!res.ok) throw new Error(j.error ?? 'Anchor could not start the withdrawal')
  return {
    id: String(j.id),
    accountId: j.account_id,
    memo: String(j.memo),
    memoType: j.memo_type ?? 'id',
    message: j.extra_info?.message,
    eta: j.eta,
  }
}
