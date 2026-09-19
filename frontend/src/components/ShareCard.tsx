import { motion } from 'motion/react'
import { useState } from 'react'
import type { Pool } from '../contract-client'
import { fmtBase } from '@/lib/money'
import { Button, Card } from './ui'

export function poolUrl(id: number) {
  const base = (import.meta.env.VITE_PUBLIC_URL as string | undefined) ?? window.location.origin
  return `${base.replace(/\/$/, '')}/p/${id}`
}

export function ShareCard({ pool, fresh }: { pool: Pool; fresh?: boolean }) {
  const url = poolUrl(pool.id)
  const [copied, setCopied] = useState(false)
  const text = `${pool.emoji} ${pool.title}\nChip in ${fmtBase(pool.target)} together → ${url}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: pool.title, text, url })
        return
      } catch {
        /* cancelled */
      }
    }
    copy()
  }

  return (
    <motion.div initial={fresh ? { scale: 0.96, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }}>
      <Card tone="ink" className="p-4">
        {fresh && <div className="font-display mb-1 text-[13px] font-bold text-accent">Your link is live</div>}
        <div className="flex items-center gap-2">
          <div className="flex h-11 flex-1 items-center overflow-hidden rounded-2xl bg-white/10 px-3 font-mono text-[13px] whitespace-nowrap">
            <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
          </div>
          <Button variant="accent" onClick={copy} className="shrink-0">
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <div className="mt-2 flex gap-2">
          <Button full variant="onInk" onClick={share}>
            Share
          </Button>
          <a
            className="inline-flex h-12 flex-1 items-center justify-center rounded-pill bg-[#25D366] px-5 text-[15px] font-semibold text-white"
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
        </div>
      </Card>
    </motion.div>
  )
}
