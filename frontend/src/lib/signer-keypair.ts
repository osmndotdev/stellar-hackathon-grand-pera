import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk'
import { basicNodeSigner } from '@stellar/stellar-sdk/contract'
import { NETWORK_PASSPHRASE } from './config'

export type SignerKind = 'instant' | 'kit' | 'script'

export interface Signer {
  kind: SignerKind
  address: string
  /** Signs a classic or Soroban transaction envelope XDR. */
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>
  /** Signs a SEP-10 challenge (same thing, kept explicit for readability). */
  signChallenge: (xdr: string) => Promise<string>
}

export function keypairSigner(kp: Keypair, kind: SignerKind = 'script'): Signer {
  const base = basicNodeSigner(kp, NETWORK_PASSPHRASE)
  return {
    kind,
    address: kp.publicKey(),
    signTransaction: base.signTransaction,
    signChallenge: async (xdr) => {
      const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE)
      tx.sign(kp)
      return tx.toXDR()
    },
  }
}
