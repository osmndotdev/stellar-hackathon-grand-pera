/**
 * Plink web server: serves the built frontend and injects Open Graph tags for
 * /p/:id so a link pasted into WhatsApp shows the pool's title and progress.
 * Pool data is read straight from the contract on Stellar RPC (short cache).
 */
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { faucetAddress, faucetBalance, faucetEnabled, faucetPay } from './faucet.js'
import { getPoolSummary } from './pool.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = process.env.FRONTEND_DIST ?? path.resolve(__dirname, '../../frontend/dist')
const PUBLIC_URL = (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const PORT = Number(process.env.PORT ?? 3000)

const app = Fastify({ logger: true })
const indexHtml = readFileSync(path.join(DIST, 'index.html'), 'utf8')

await app.register(fastifyStatic, {
  root: DIST,
  prefix: '/',
  index: false,
  wildcard: false,
})

app.get('/healthz', async () => ({ ok: true }))

// Demo faucet (testnet). See faucet.ts.
app.get('/api/faucet', async () => ({
  enabled: faucetEnabled(),
  address: faucetAddress(),
  balance: faucetEnabled() ? await faucetBalance().catch(() => null) : null,
}))
app.post('/api/faucet', async (req, reply) => {
  if (!faucetEnabled()) return reply.code(404).send({ error: 'faucet disabled' })
  const { address, usd } = (req.body ?? {}) as { address?: string; usd?: number }
  try {
    const hash = await faucetPay(String(address ?? ''), Number(usd ?? 0))
    return { hash }
  } catch (e) {
    req.log.warn({ err: e }, 'faucet failed')
    return reply.code(400).send({ error: (e as Error).message })
  }
})

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function withMeta(html: string, meta: { title: string; description: string; url: string; image: string }) {
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Plink" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    `<meta property="og:image" content="${esc(meta.image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(meta.image)}" />`,
  ].join('\n    ')
  return html
    .replace(/<title>.*?<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(meta.description)}" />`)
    .replace('</head>', `    ${tags}\n  </head>`)
}

const defaultMeta = (url: string) => ({
  title: 'Plink',
  description: 'Create a payment link in a blink. Group funding that unlocks only when the goal is reached.',
  url,
  image: `${PUBLIC_URL}/og.png`,
})

app.get('/p/:id', async (req, reply) => {
  const id = Number((req.params as { id: string }).id)
  const url = `${PUBLIC_URL}/p/${id}`
  let meta = defaultMeta(url)
  if (Number.isInteger(id) && id > 0) {
    try {
      const p = await getPoolSummary(id)
      if (p) {
        meta = {
          title: `${p.emoji} ${p.title}`,
          description: `${p.raised} of ${p.target} raised · ${p.status}. ${p.organizer} is collecting on Plink.`,
          url,
          image: `${PUBLIC_URL}/og.png`,
        }
      }
    } catch (e) {
      req.log.warn({ err: e }, 'pool lookup failed')
    }
  }
  reply.type('text/html').send(withMeta(indexHtml, meta))
})

// SPA fallback.
app.setNotFoundHandler((req, reply) => {
  if (req.method !== 'GET' || req.url.startsWith('/assets/')) {
    reply.code(404).send({ error: 'not found' })
    return
  }
  reply.type('text/html').send(withMeta(indexHtml, defaultMeta(`${PUBLIC_URL}${req.url}`)))
})

await app.listen({ port: PORT, host: '0.0.0.0' })
