/**
 * Signers. Two kinds:
 *  - "instant": a keypair Plink creates for this browser profile, stored in
 *    localStorage and funded by testnet friendbot. Nobody has to install
 *    anything. Clearly a testnet convenience; on mainnet this would be an
 *    embedded wallet provider.
 *  - "kit": an external wallet via Stellar Wallets Kit (Freighter etc.).
 */
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit'
import { defaultModules } from '@creit.tech/stellar-wallets-kit/modules/utils'
import { Networks } from '@creit.tech/stellar-wallets-kit/types'
import { Keypair } from '@stellar/stellar-sdk'
import { NETWORK_PASSPHRASE } from './config'
import { keypairSigner, type Signer } from './signer-keypair'

export type { Signer, SignerKind } from './signer-keypair'

const LS_SECRET = 'plink.instant.secret'
const LS_NAME = 'plink.name'
const LS_KIT = 'plink.kit.connected'

// ----------------------------------------------------------- instant wallet

export function getInstantKeypair(): Keypair {
  let secret: string | null = null
  try {
    secret = localStorage.getItem(LS_SECRET)
  } catch {
    /* private mode */
  }
  if (secret) return Keypair.fromSecret(secret)
  const kp = Keypair.random()
  try {
    localStorage.setItem(LS_SECRET, kp.secret())
  } catch {
    /* ignore */
  }
  return kp
}

export function resetInstantWallet() {
  try {
    localStorage.removeItem(LS_SECRET)
  } catch {
    /* ignore */
  }
}

export function instantSigner(): Signer {
  return keypairSigner(getInstantKeypair(), 'instant')
}

// ------------------------------------------------------------- wallets kit

let kitReady = false
export function initKit() {
  if (kitReady) return
  StellarWalletsKit.init({
    modules: defaultModules(),
    network: Networks.TESTNET,
  })
  kitReady = true
}

export async function connectKit(): Promise<Signer> {
  initKit()
  const { address } = await StellarWalletsKit.authModal()
  try {
    localStorage.setItem(LS_KIT, '1')
  } catch {
    /* ignore */
  }
  return kitSigner(address)
}

export async function restoreKit(): Promise<Signer | null> {
  try {
    if (localStorage.getItem(LS_KIT) !== '1') return null
  } catch {
    return null
  }
  initKit()
  try {
    const { address } = await StellarWalletsKit.getAddress()
    return address ? kitSigner(address) : null
  } catch {
    return null
  }
}

export async function disconnectKit() {
  try {
    localStorage.removeItem(LS_KIT)
  } catch {
    /* ignore */
  }
  if (kitReady) await StellarWalletsKit.disconnect().catch(() => {})
}

function kitSigner(address: string): Signer {
  return {
    kind: 'kit',
    address,
    signTransaction: (xdr, opts) =>
      StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: opts?.networkPassphrase ?? NETWORK_PASSPHRASE,
        address,
      }),
    signChallenge: async (xdr) => {
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address,
      })
      return signedTxXdr
    },
  }
}

// ------------------------------------------------------------ display name

export function getSavedName(): string {
  try {
    return localStorage.getItem(LS_NAME) ?? ''
  } catch {
    return ''
  }
}
export function saveName(name: string) {
  try {
    localStorage.setItem(LS_NAME, name)
  } catch {
    /* ignore */
  }
}
