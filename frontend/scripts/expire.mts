/**
 * Stage a refund demo without the anchor: optionally contribute from a persona
 * that already holds USDC, then move the pool's deadline into the past with the
 * admin-only debug helper.
 * Usage: pnpm tsx scripts/expire.mts <poolId> [persona] [usd]
 */
import { Keypair } from '@stellar/stellar-sdk'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fromUsdc } from '../src/lib/money'
import { keypairSigner } from '../src/lib/signer-keypair'
import { getBalances, writeClient } from '../src/lib/stellar'

const [idArg, who, usdArg] = process.argv.slice(2)
const id = Number(idArg)
if (!id) throw new Error('pool id required')
const state = JSON.parse(readFileSync(new URL('./.seed-state.json', import.meta.url), 'utf8'))
const admin = keypairSigner(Keypair.fromSecret(process.env.PLINK_ADMIN_SECRET ?? execSync('stellar keys secret plink-deployer', { encoding: 'utf8' }).trim()))

if (who) {
  const s = keypairSigner(Keypair.fromSecret(state.personas[who]))
  const bal = (await getBalances(s.address)).usdc
  const usd = Math.min(Number(usdArg ?? bal), Math.floor(bal * 100) / 100)
  const name = who[0].toUpperCase() + who.slice(1)
  const tx = await writeClient(s).contribute({ id, from: s.address, amount: fromUsdc(usd), name, method: 'bank' })
  const sent = await tx.signAndSend()
  console.log(`${name} contributed $${usd} to #${id} → ${sent.sendTransactionResponse?.hash}`)
}
const past = BigInt(Math.floor(Date.now() / 1000) - 3600)
await (await writeClient(admin).debug_set_deadline({ id, deadline: past })).signAndSend()
console.log(`pool #${id} deadline moved to the past`)
