import deployment from '../../../deployments/testnet.json'

export const NETWORK_PASSPHRASE = deployment.networkPassphrase
export const RPC_URL = deployment.rpcUrl
export const HORIZON_URL = deployment.horizonUrl
export const CONTRACT_ID = deployment.contractId
export const USDC_CODE = deployment.usdc.code
export const USDC_ISSUER = deployment.usdc.issuer
export const USDC_SAC = deployment.usdc.sac
export const ANCHOR_HOME_DOMAIN = deployment.anchor.homeDomain
export const FRIENDBOT_URL = 'https://friendbot.stellar.org'

/** USDC has 7 decimals on Stellar. */
export const USDC_DECIMALS = 7
export const ONE_USDC = 10_000_000n

export const explorerTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`
export const explorerAccount = (addr: string) =>
  `https://stellar.expert/explorer/testnet/account/${addr}`
export const explorerContract = (id: string) =>
  `https://stellar.expert/explorer/testnet/contract/${id}`
