// Exercise the anchor cash-out path (SEP-6 withdraw → USDC payment with memo → completed).
import { Keypair } from '@stellar/stellar-sdk'
import { readFileSync } from 'node:fs'
import * as anchor from '../src/lib/anchor'
import { keypairSigner } from '../src/lib/signer-keypair'
import { getBalances, payUsdc } from '../src/lib/stellar'
const state = JSON.parse(readFileSync(new URL('./.seed-state.json', import.meta.url), 'utf8'))
const s = keypairSigner(Keypair.fromSecret(state.personas[process.argv[2] ?? 'zeynep']))
const usd = Number(process.argv[3] ?? '1')
console.log(new Date().toISOString(), s.address, await getBalances(s.address))
const order = await anchor.startWithdraw(s, usd)
console.log('withdraw order', order)
const t0 = Date.now()
const hash = await payUsdc(s, order.accountId, usd.toFixed(7), order.memo)
console.log('paid', hash)
const done = await anchor.waitForStatus(s, order.id, (t) => console.log(new Date().toISOString(), t.status), { timeoutMs: 10 * 60_000 })
console.log('final', done, `${Math.round((Date.now() - t0) / 1000)}s`)
