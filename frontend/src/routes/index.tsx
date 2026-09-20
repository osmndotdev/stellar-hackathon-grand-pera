import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Button, Card, Field, cx, inputCls } from '@/components/ui'
import { useWallet } from '@/hooks/useWallet'
import { friendlyError } from '@/lib/errors'
import { fromUsdc, fmtUsd } from '@/lib/money'
import { writeClient } from '@/lib/stellar'
import { getSavedName, saveName } from '@/lib/wallet'
import { EMOJIS, VIBES, vibeStyle } from '@/lib/vibes'

export const Route = createFileRoute('/')({
  component: CreatePage,
})

const DEADLINES: { label: string; hours: number }[] = [
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
  { label: '2 weeks', hours: 336 },
]

function CreatePage() {
  const navigate = useNavigate()
  const { signer, ensureReady } = useWallet()
  const [title, setTitle] = useState('')
  const [organizer, setOrganizer] = useState(getSavedName())
  const [target, setTarget] = useState('')
  const [hours, setHours] = useState(72)
  const [vibe, setVibe] = useState(0)
  const [emoji, setEmoji] = useState(EMOJIS[0])
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const targetNum = Number(target)
  const valid = title.trim().length > 0 && organizer.trim().length > 0 && targetNum > 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setErr(null)
    try {
      saveName(organizer.trim())
      setPhase('Setting up your account…')
      await ensureReady()
      setPhase('Publishing your link on Stellar…')
      const client = writeClient(signer)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + hours * 3600)
      const tx = await client.create({
        creator: signer.address,
        organizer: organizer.trim(),
        title: title.trim(),
        target: fromUsdc(targetNum),
        deadline,
        emoji,
        vibe,
      })
      const sent = await tx.signAndSend()
      const id = sent.result.unwrap()
      navigate({ to: '/p/$id', params: { id: String(id) }, search: { new: true } })
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
      setPhase(null)
    }
  }

  return (
    <div style={vibeStyle(vibe)} className="pt-2">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
      >
        <h1 className="font-display text-[34px] leading-[1.05] font-extrabold tracking-tight">
          Create a payment link
          <br />
          <span className="rounded-xl bg-accent px-2 text-on-accent">in a blink.</span>
        </h1>
        <p className="mt-3 text-[15px] text-ink-2">
          Share it in the group chat. Everyone chips in by bank transfer or crypto. Money only
          unlocks if you hit the target, otherwise everyone gets it back.
        </p>
      </motion.div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Card className="space-y-4 p-4">
          <Field label="Goal">
            <input
              className={cx(inputCls, 'font-display h-14 text-[18px] font-bold')}
              placeholder="Weekend house in Şile"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Your name">
            <input
              className={inputCls}
              placeholder="Osman"
              value={organizer}
              maxLength={32}
              onChange={(e) => setOrganizer(e.target.value)}
            />
          </Field>
          <Field label="Target" hint="Collected in USDC on Stellar. Bank payers see the ₺ equivalent.">
            <div className="relative">
              <span className="font-display absolute top-1/2 left-4 -translate-y-1/2 text-[18px] font-bold">
                $
              </span>
              <input
                className={cx(inputCls, 'font-display h-14 pl-9 text-[22px] font-bold tabular')}
                placeholder="300"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
          </Field>
          <Field label="Deadline">
            <div className="flex flex-wrap gap-2">
              {DEADLINES.map((d) => (
                <button
                  type="button"
                  key={d.hours}
                  onClick={() => setHours(d.hours)}
                  className={cx(
                    'h-10 rounded-pill px-4 text-[14px] font-semibold transition-colors',
                    hours === d.hours ? 'bg-ink text-white' : 'bg-black/5 text-ink-2 hover:bg-black/10',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Field>
        </Card>

        <Card className="space-y-4 p-4">
          <Field label="Pick a vibe">
            <div className="flex gap-3">
              {VIBES.map((v, i) => (
                <button
                  type="button"
                  key={v.name}
                  aria-label={v.name}
                  onClick={() => setVibe(i)}
                  className={cx(
                    'size-10 rounded-full transition-transform',
                    vibe === i ? 'scale-110 ring-[3px] ring-ink ring-offset-2 ring-offset-white' : 'hover:scale-105',
                  )}
                  style={{ background: v.accent }}
                />
              ))}
            </div>
          </Field>
          <Field label="And a sticker">
            <div className="flex flex-wrap gap-2">
              {EMOJIS.map((e) => (
                <button
                  type="button"
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={cx(
                    'size-11 rounded-2xl text-[22px] transition-transform',
                    emoji === e ? 'scale-110 bg-accent' : 'bg-black/5 hover:scale-105',
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </Field>
        </Card>

        <Button type="submit" size="lg" full disabled={!valid} loading={busy}>
          {targetNum > 0 ? `Create link for ${fmtUsd(targetNum)}` : 'Create link'}
        </Button>
        {phase && <p className="text-center text-[13px] text-muted">{phase}</p>}
        {err && <p className="text-center text-[13px] text-[#D33]">{err}</p>}
      </form>
    </div>
  )
}
