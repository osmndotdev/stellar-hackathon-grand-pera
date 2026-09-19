export function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e)
  if (/InvalidDeadline/.test(msg)) return 'That deadline is already in the past.'
  if (/PoolClosed/.test(msg)) return 'This link has closed for contributions.'
  if (/AlreadyClaimed/.test(msg)) return 'The organizer already claimed this pool.'
  if (/TargetNotReached/.test(msg)) return 'The goal has not been reached yet.'
  if (/NotRefundable/.test(msg)) return 'Refunds open only after the deadline if the goal was missed.'
  if (/NothingToRefund/.test(msg)) return 'Nothing to refund for this account.'
  if (/trustline|op_no_trust/i.test(msg)) return 'Your account needs a USDC trustline first.'
  if (/underfunded|op_underfunded|balance/i.test(msg)) return 'Not enough USDC in your account.'
  if (/User declined|rejected/i.test(msg)) return 'You cancelled the signature.'
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg
}
