import { addItems, frameAt, getItem, maxZ, newId, updateItem } from './board'
import { select } from './store'
import type { Item, LinkMeta, Point, VideoInfo } from './types'

export const URL_RE = /^https?:\/\/[^\s]+$/i

export function detectVideo (raw: string): VideoInfo | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  const host = u.hostname.replace(/^(www\.|m\.)/, '')
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id: string | null = null
    if (host === 'youtu.be') id = u.pathname.slice(1)
    else if (u.pathname === '/watch') id = u.searchParams.get('v')
    else { const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/); if (m) id = m[2] }
    if (!id) return null
    const t = u.searchParams.get('t') || u.searchParams.get('start')
    const start = t ? parseInt(t, 10) || 0 : 0
    return {
      provider: 'youtube',
      embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? `&start=${start}` : ''}`,
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    }
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/(\d{6,})/)
    if (m) return { provider: 'vimeo', embed: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, thumb: null }
  }
  if (host === 'dailymotion.com' || host === 'dai.ly') {
    const m = u.pathname.match(/(?:video\/|^\/)([a-z0-9]+)/i)
    if (m) return { provider: 'dailymotion', embed: `https://www.dailymotion.com/embed/video/${m[1]}?autoplay=1`, thumb: `https://www.dailymotion.com/thumbnail/video/${m[1]}` }
  }
  if (host === 'loom.com') {
    const m = u.pathname.match(/\/share\/([\w]+)/)
    if (m) return { provider: 'loom', embed: `https://www.loom.com/embed/${m[1]}?autoplay=1`, thumb: null }
  }
  if (/\.(mp4|webm|ogv|mov|m4v)$/i.test(u.pathname)) return { provider: 'file', embed: u.href, thumb: null }
  return null
}

export async function fetchMeta (url: string): Promise<LinkMeta> {
  // Prefer the bundled server; fall back to a public unfurl API on static hosts.
  try {
    const r = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
    if (r.ok && r.headers.get('content-type')?.includes('json')) return await r.json()
  } catch { /* no server */ }
  const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`)
  const j = await r.json()
  if (j.status !== 'success') throw new Error('unfurl failed')
  const d = j.data
  return { url: d.url, title: d.title, description: d.description, image: d.image?.url, siteName: d.publisher, favicon: d.logo?.url, video: d.video?.url ?? null }
}

export function hostOf (url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

/** Fill a link/video card with metadata (only the client that created the card does this). */
export async function unfurlInto (id: string) {
  const it = getItem(id)
  if (!it?.url) return
  updateItem(id, { status: 'loading' })
  try {
    const meta = await fetchMeta(it.url)
    const cur = getItem(id)
    if (!cur) return
    const patch: Partial<Item> = { meta, status: 'ok' }
    if (cur.type === 'video' && cur.video && !cur.video.thumb && meta.image) patch.video = { ...cur.video, thumb: meta.image }
    if (cur.type === 'link' && !meta.image && cur.h > 200) patch.h = 132
    updateItem(id, patch)
  } catch {
    updateItem(id, { status: 'error', h: getItem(id)?.type === 'link' ? 132 : getItem(id)!.h })
  }
}

function placed (it: Item): Item {
  return { ...it, parentId: frameAt(it)?.id ?? null }
}

export function createUrlItem (url: string, at: Point): Item {
  const video = detectVideo(url)
  const w = video ? 480 : 340
  const h = video ? 270 + 64 : 300
  const it = placed({
    id: newId(), type: video ? 'video' : 'link', url, video, meta: null, status: 'loading',
    x: at.x - w / 2, y: at.y - h / 2, w, h, z: maxZ() + 1
  })
  addItems([it])
  select([it.id])
  unfurlInto(it.id)
  return it
}

export function createTextItem (text: string, at: Point) {
  const lines = text.split('\n')
  const w = Math.min(600, Math.max(160, Math.max(...lines.map((l) => l.length)) * 9))
  const h = Math.max(40, lines.length * 26 + 16)
  const it = placed({ id: newId(), type: 'text', text, x: at.x - w / 2, y: at.y - h / 2, w, h, z: maxZ() + 1, fontSize: 18, color: '#1f2937', align: 'left' })
  addItems([it])
  select([it.id])
}

/** Downscale large images so they stay reasonable inside the shared document. */
export function createImageItem (file: Blob, at: Point) {
  const img = new Image()
  const url = URL.createObjectURL(file)
  img.onload = () => {
    const max = 1600
    const s = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const src = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85)
    URL.revokeObjectURL(url)
    const w = Math.min(480, c.width); const h = w * c.height / c.width
    const it = placed({ id: newId(), type: 'image', src, x: at.x - w / 2, y: at.y - h / 2, w, h, z: maxZ() + 1 })
    addItems([it])
    select([it.id])
  }
  img.src = url
}
