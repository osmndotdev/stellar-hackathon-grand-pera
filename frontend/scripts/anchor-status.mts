import { Keypair } from '@stellar/stellar-sdk'
import { readFileSync } from 'node:fs'
import * as anchor from '../src/lib/anchor'
import { keypairSigner } from '../src/lib/signer-keypair'
import { getBalances } from '../src/lib/stellar'
const state = JSON.parse(readFileSync(new URL('./.seed-state.json', import.meta.url), 'utf8'))
const who = process.argv[2] ?? 'ayse'
const s = keypairSigner(Keypair.fromSecret(state.personas[who]))
console.log(who, s.address, await getBalances(s.address))
const ep = await anchor.discover()
const token = await anchor.authenticate(s)
const r = await fetch(`${ep.transferServer}/transactions?asset_code=USDC`, { headers: { Authorization: `Bearer ${token}` } })
console.log(JSON.stringify(await r.json(), null, 1).slice(0, 3000))
