// Image uploads to S3-compatible storage (Cloudflare R2, Backblaze B2, Supabase…).
// Boards then keep only a URL, so images are served by the storage provider
// instead of being copied into every board sync.
//
// Env: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
//      S3_PUBLIC_URL (public base URL of the bucket), S3_REGION (default "auto")

import crypto from 'node:crypto'
import { AwsClient } from 'aws4fetch'

const MAX_BYTES = 10 * 1024 * 1024
const PER_HOUR = 120

// File signatures: only raster formats (SVG could carry scripts).
const TYPES = [
  { ext: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8' },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' }
]

export function imageConfig (env) {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL } = env
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_PUBLIC_URL) return null
  return {
    endpoint: S3_ENDPOINT.replace(/\/+$/, ''),
    bucket: S3_BUCKET,
    publicUrl: S3_PUBLIC_URL.replace(/\/+$/, ''),
    client: new AwsClient({ accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY, service: 's3', region: env.S3_REGION || 'auto' })
  }
}

const hits = new Map() // ip -> timestamps of recent uploads

function rateLimited (ip) {
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.delete(hits.keys().next().value)
  return recent.length > PER_HOUR
}

async function readBody (req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BYTES) throw Object.assign(new Error('Image trop lourde (10 Mo max)'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** POST /api/upload?board=<id> with the raw image as body. Responds { url }. */
export async function handleUpload (cfg, req, res, url) {
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (!cfg) return reply(501, { error: 'Stockage d’images non configuré' })
  if (req.method !== 'POST') return reply(405, { error: 'POST attendu' })
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
  if (rateLimited(ip)) return reply(429, { error: 'Trop d’envois, réessayez plus tard' })
  try {
    const body = await readBody(req)
    const type = TYPES.find((t) => t.test(body))
    if (!type) return reply(415, { error: 'Format non pris en charge (PNG, JPEG, GIF, WebP)' })
    const board = /^[\w-]{3,64}$/.test(url.searchParams.get('board') || '') ? url.searchParams.get('board') : 'misc'
    const key = `img/${board}/${crypto.randomBytes(9).toString('base64url')}.${type.ext}`
    const put = await cfg.client.fetch(`${cfg.endpoint}/${cfg.bucket}/${key}`, {
      method: 'PUT',
      body,
      headers: { 'content-type': type.mime, 'cache-control': 'public, max-age=31536000, immutable' }
    })
    if (!put.ok) {
      console.error('[images] upload failed', put.status, (await put.text()).slice(0, 300))
      return reply(502, { error: 'Le stockage a refusé l’image' })
    }
    reply(200, { url: `${cfg.publicUrl}/${key}` })
  } catch (e) {
    reply(e.status || 500, { error: e.message })
  }
}
