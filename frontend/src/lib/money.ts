import { ONE_USDC } from './config'

/** Base units (bigint, 7 decimals) → number of USDC. */
export const toUsdc = (base: bigint | number | string): number =>
  Number(BigInt(base)) / Number(ONE_USDC)

/** Number of USDC → base units (bigint). Rounds to 7 decimals. */
export const fromUsdc = (usdc: number): bigint =>
  BigInt(Math.round(usdc * Number(ONE_USDC)))

export const fmtUsd = (usdc: number, opts: Intl.NumberFormatOptions = {}) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: usdc % 1 === 0 ? 0 : 2,
    ...opts,
  }).format(usdc)

export const fmtTry = (tr: number) =>
  new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
  }).format(tr)

/** "$1,234" for base-unit bigint. */
export const fmtBase = (base: bigint | number | string) => fmtUsd(toUsdc(base))

export const pct = (raised: bigint, target: bigint) =>
  target === 0n ? 0 : Math.min(100, Number((raised * 10_000n) / target) / 100)
