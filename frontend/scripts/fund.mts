/**
 * Fund an account with test USDC through the anchor, in ≤ ₺3000 chunks.
 * Usage: pnpm tsx scripts/fund.mts <secret|persona|cli-alias> <usd>
 */
import { Keypair } from '@stellar/stellar-sdk'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import * as anchor from '../src/lib/anchor'
import { keypairSigner } from '../src/lib/signer-keypair'
import { getBalances, prepareAccount } from '../src/lib/stellar'

const [who, usdArg] = process.argv.slice(2)
const target = Number(usdArg ?? '60')
const STATE = new URL('./.seed-state.json', import.meta.url)
const personas = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).personas : {}
let secret = who
if (!(who.startsWith('S') && who.length === 56)) {
  secret = personas[who] ?? execSync(`stellar keys secret ${who}`, { encoding: 'utf8' }).trim()
}
const s = keypairSigner(Keypair.fromSecret(secret))
await prepareAccount(s)
const start = await getBalances(s.address)
console.log(`${s.address} has ${start.usdc} USDC, funding up to ${target}`)
const p = await anchor.priceTryToUsdc(1000)
const chunkUsd = Math.floor((2990 / p.tryPerUsdc) * 100) / 100
let have = start.usdc
while (have + 0.01 < target) {
  const usd = Math.min(chunkUsd, target - have)
  const tr = Math.ceil(usd * p.tryPerUsdc * 100 + 1) / 100
  const t0 = Date.now()
  const order = await anchor.startDeposit(s, tr)
  await anchor.simulateBankTransfer(s, order.id, tr)
  const done = await anchor.waitForStatus(s, order.id, () => {}, { timeoutMs: 15 * 60_000 })
  if (done.status !== 'completed') throw new Error(`deposit ${order.id} ${done.status}: ${done.message}`)
  have = (await getBalances(s.address)).usdc
  console.log(`  +${usd} USDC in ${Math.round((Date.now() - t0) / 1000)}s → ${have}`)
}
console.log('done', have)
