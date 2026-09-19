/**
 * Seeds the demo on testnet:
 *   1. "Weekend house in Şile": $120 goal, two contributions in ($50 Ayşe by
 *      bank, $40 Mert in USDC) → $30 to go. The live demo finishes it.
 *   2. "Class trip to Ankara": $500 goal, one $40 contribution, deadline
 *      moved into the past with the admin-only debug helper → refund demo.
 *
 * Personas are real testnet accounts (kept in scripts/.seed-state.json so
 * re-runs reuse them). Their USDC comes through the anchor's TRY deposit,
 * exactly like a user would get it.
 *
 * Usage: pnpm tsx scripts/seed.mts [--creator-secret S...] [--admin-secret S...]
 */
import { Keypair } from '@stellar/stellar-sdk'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import * as anchor from '../src/lib/anchor'
import { CONTRACT_ID } from '../src/lib/config'
import { fromUsdc } from '../src/lib/money'
import { keypairSigner, type Signer } from '../src/lib/signer-keypair'
import { getBalances, prepareAccount, writeClient } from '../src/lib/stellar'

const STATE = new URL('./.seed-state.json', import.meta.url)
type State = { personas: Record<string, string>; pools?: Record<string, number> }
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { personas: {} }
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n')

const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i > -1 ? process.argv[i + 1] : undefined
}
const cliSecret = (alias: string) => execSync(`stellar keys secret ${alias}`, { encoding: 'utf8' }).trim()

const adminSecret = arg('--admin-secret') ?? process.env.PLINK_ADMIN_SECRET ?? cliSecret('plink-deployer')
const creatorSecret = arg('--creator-secret') ?? process.env.PLINK_CREATOR_SECRET
const admin = keypairSigner(Keypair.fromSecret(adminSecret))
const log = (s: string) => console.log(`• ${s}`)

function persona(name: string): Signer {
  if (!state.personas[name]) {
    state.personas[name] = Keypair.random().secret()
    save()
  }
  return keypairSigner(Keypair.fromSecret(state.personas[name]))
}

async function ensureUsdc(s: Signer, usd: number) {
  await prepareAccount(s)
  const b = await getBalances(s.address)
  if (b.usdc >= usd) return
  const need = usd - b.usdc
  const p = await anchor.priceTryToUsdc(1000)
  const tr = Math.ceil(need * p.tryPerUsdc * 100 + 1) / 100
  log(`  ${s.address.slice(0, 5)}… depositing ₺${tr} via anchor for ${need} USDC`)
  const order = await anchor.startDeposit(s, tr)
  await anchor.simulateBankTransfer(s, order.id, tr)
  const done = await anchor.waitForStatus(s, order.id, () => {})
  if (done.status !== 'completed') throw new Error(`anchor deposit ${done.status}: ${done.message}`)
}

async function contribute(s: Signer, id: number, usd: number, name: string, method: 'bank' | 'crypto') {
  await ensureUsdc(s, usd)
  const tx = await writeClient(s).contribute({ id, from: s.address, amount: fromUsdc(usd), name, method })
  const sent = await tx.signAndSend()
  log(`  ${name} contributed $${usd} (${method}) → tx ${sent.sendTransactionResponse?.hash}`)
}

async function createPool(creator: Signer, organizer: string, title: string, usd: number, hours: number, emoji: string, vibe: number) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + hours * 3600)
  const tx = await writeClient(creator).create({
    creator: creator.address, organizer, title, target: fromUsdc(usd), deadline, emoji, vibe,
  })
  const sent = await tx.signAndSend()
  const id = sent.result.unwrap()
  log(`  pool #${id} "${title}" created → tx ${sent.sendTransactionResponse?.hash}`)
  return id
}

const creator = creatorSecret ? keypairSigner(Keypair.fromSecret(creatorSecret)) : persona('creator')
const ayse = persona('ayse')
const mert = persona('mert')
const zeynep = persona('zeynep')

log(`contract ${CONTRACT_ID}`)
log(`creator  ${creator.address}${creatorSecret ? ' (from --creator-secret)' : ' (persona; pass --creator-secret to use your browser account)'}`)
await prepareAccount(creator)

log('Pool 1: Weekend house in Şile, $120, $30 to go')
const p1 = await createPool(creator, 'Osman', 'Weekend house in Şile', 120, 48, '🏡', 1)
await contribute(ayse, p1, 50, 'Ayşe', 'bank')
await contribute(mert, p1, 40, 'Mert', 'crypto')

log('Pool 2: Class trip to Ankara, $500, expired with $40 in')
const p2 = await createPool(creator, 'Osman', 'Class trip to Ankara', 500, 1, '🎓', 2)
await contribute(zeynep, p2, 40, 'Zeynep', 'bank')
const past = BigInt(Math.floor(Date.now() / 1000) - 3600)
const dl = await writeClient(admin).debug_set_deadline({ id: p2, deadline: past })
await dl.signAndSend()
log(`  deadline moved to the past (admin debug helper)`)

state.pools = { house: p1, trip: p2 }
save()
console.log(`
Demo links:
  house (one $30 chip-in from the goal):  /p/${p1}
  trip  (expired, Zeynep can refund):     /p/${p2}
Refund persona Zeynep secret is in scripts/.seed-state.json (import into the
browser via the demo panel to demo the refund).
`)
