// Link unfurling: fetches a page and extracts Open Graph / Twitter / oEmbed metadata.
// Private and loopback addresses are refused so the server cannot be used to
// probe the host's network.

import dns from 'node:dns/promises'
import net from 'node:net'

const cache = new Map() // url -> { at, data }
const TTL = 6 * 3600 * 1000
const MAX_BYTES = 1_500_000
const UA = 'Mozilla/5.0 (compatible; PlancheBot/0.1; +https://github.com/) facebookexternalhit/1.1'

function isPrivateIp (ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7))
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')
}

async function assertPublic (u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Seuls http(s) sont acceptés')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true })
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('Adresse privée refusée')
}

async function fetchPublic (url, accept) {
  let current = new URL(url)
  for (let i = 0; i < 5; i++) {
    await assertPublic(current)
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': UA, accept, 'accept-language': 'fr,en;q=0.8' }
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current)
      continue
    }
    return { res, finalUrl: current.href }
  }
  throw new Error('Trop de redirections')
}

async function readLimited (res) {
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
    // Metadata lives in <head>; stop early once it is closed.
    if (Buffer.from(value).includes('</head>')) break
  }
  reader.cancel().catch(() => {})
  return Buffer.concat(chunks).toString('utf8')
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities (s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function parseAttrs (tag) {
  const attrs = {}
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '')
  }
  return attrs
}

function parseHtml (html, base) {
  const meta = {}
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = parseAttrs(m[0])
    const key = (a.property || a.name || a.itemprop || '').toLowerCase()
    if (key && a.content && !(key in meta)) meta[key] = a.content.trim()
  }
  let icon = null
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = parseAttrs(m[0])
    const rel = (a.rel || '').toLowerCase()
    if (a.href && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(rel) && (!icon || rel.includes('apple'))) icon = a.href
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const abs = (v) => { try { return v ? new URL(v, base).href : null } catch { return null } }
  return {
    url: abs(meta['og:url']) || base,
    title: meta['og:title'] || meta['twitter:title'] || (titleTag ? decodeEntities(titleTag[1]).trim() : null),
    description: meta['og:description'] || meta['twitter:description'] || meta.description || null,
    image: abs(meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src']),
    siteName: meta['og:site_name'] || new URL(base).hostname.replace(/^www\./, ''),
    favicon: abs(icon) || new URL('/favicon.ico', base).href,
    video: abs(meta['og:video:secure_url'] || meta['og:video:url'] || meta['og:video'] || meta['twitter:player']),
    type: meta['og:type'] || null
  }
}

const OEMBED = [
  [/^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//, 'https://www.youtube.com/oembed?format=json&url='],
  [/^(https?:\/\/)?(www\.)?vimeo\.com\//, 'https://vimeo.com/api/oembed.json?url='],
  [/^(https?:\/\/)?(www\.)?dailymotion\.com\//, 'https://www.dailymotion.com/services/oembed?format=json&url='],
  [/^(https?:\/\/)?(www\.)?loom\.com\//, 'https://www.loom.com/v1/oembed?url=']
]

async function tryOembed (url) {
  const hit = OEMBED.find(([re]) => re.test(url))
  if (!hit) return null
  const { res } = await fetchPublic(hit[1] + encodeURIComponent(url), 'application/json')
  if (!res.ok) return null
  const j = await res.json()
  return {
    url,
    title: j.title || null,
    description: j.author_name ? `par ${j.author_name}` : null,
    image: j.thumbnail_url || null,
    siteName: j.provider_name || new URL(url).hostname,
    favicon: new URL('/favicon.ico', url).href,
    video: null,
    type: 'video'
  }
}

export async function unfurl (raw) {
  let url
  try { url = new URL(raw).href } catch { throw new Error('URL invalide') }
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < TTL) return hit.data

  let data = await tryOembed(url).catch(() => null)
  if (!data) {
    const { res, finalUrl } = await fetchPublic(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5')
    const type = res.headers.get('content-type') || ''
    if (type.startsWith('image/')) {
      data = { url, title: decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || url), image: finalUrl, siteName: new URL(finalUrl).hostname, favicon: null, description: null, video: null, type: 'image' }
      res.body?.cancel().catch(() => {})
    } else if (type.startsWith('video/')) {
      data = { url, title: decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || url), image: null, siteName: new URL(finalUrl).hostname, favicon: null, description: null, video: finalUrl, type: 'video' }
      res.body?.cancel().catch(() => {})
    } else {
      data = parseHtml(await readLimited(res), finalUrl)
    }
  }
  cache.set(url, { at: Date.now(), data })
  if (cache.size > 2000) cache.delete(cache.keys().next().value)
  return data
}
