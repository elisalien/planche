import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { ExternalLink, Eye, Play, RefreshCw } from 'lucide-react'
import { updateItem, transact } from '../board'
import { createStore, ui, useStore } from '../store'
import { hostOf, unfurlInto } from '../media'
import type { Item } from '../types'

/** Which video is playing inline is per-viewer state, not shared. */
export const playing = createStore<{ id: string | null }>({ id: null })

export const PATTERNS: Record<string, string> = {
  none: 'none',
  dots: 'radial-gradient(circle, rgba(0,0,0,.18) 1px, transparent 1.4px)',
  grid: 'linear-gradient(rgba(0,0,0,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.07) 1px, transparent 1px)',
  lines: 'linear-gradient(rgba(0,0,0,.08) 1px, transparent 1px)'
}

function EditableText ({ it, className, style }: { it: Item; className?: string; style?: React.CSSProperties }) {
  const editing = useStore(ui, (s) => s.editing === it.id)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!editing || !el) return
    el.innerText = it.text ?? ''
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const commit = () => {
    const el = ref.current
    if (!el) return
    const text = el.innerText.replace(/\n$/, '')
    transact(() => {
      const patch: Partial<Item> = { text }
      // Free text grows with its content.
      if (it.type === 'text') patch.h = Math.max(it.h, Math.ceil(el.scrollHeight))
      updateItem(it.id, patch)
    })
    if (ui.get().editing === it.id) ui.set({ editing: null })
  }

  if (editing) {
    return (
      <div
        ref={ref}
        className={`text editing ${className ?? ''}`}
        style={style}
        contentEditable
        suppressContentEditableWarning
        data-nodrag
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ref.current?.blur() }
          e.stopPropagation()
        }}
      />
    )
  }
  return <div className={`text ${className ?? ''}`} style={style}>{it.text}</div>
}

/** Shrinks sticky text until it fits, like paper notes do. */
function useFitText (ref: React.RefObject<HTMLDivElement | null>, deps: unknown[], max: number) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const t = el.querySelector('.text') as HTMLElement | null
    if (!t || t.classList.contains('editing')) return
    let size = max
    t.style.fontSize = `${size}px`
    while (size > 8 && (t.scrollHeight > el.clientHeight - 16 || t.scrollWidth > el.clientWidth - 16)) {
      size -= size > 20 ? 2 : 1
      t.style.fontSize = `${size}px`
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

function Sticky ({ it }: { it: Item }) {
  const ref = useRef<HTMLDivElement>(null)
  useFitText(ref, [it.text, it.w, it.h], it.fontSize ?? Math.round(Math.min(it.w, it.h) / 6.5))
  return (
    <div ref={ref} className='sticky' style={{ background: it.fill ?? '#fde68a', textAlign: it.align ?? 'center' }}>
      <EditableText it={it} style={{ color: it.color }} />
    </div>
  )
}

function Shape ({ it }: { it: Item }) {
  const kind = it.shape ?? 'rect'
  const fill = it.fill ?? '#ffffff'
  const stroke = it.stroke ?? '#1f2937'
  return (
    <div className='shape' style={{
      background: kind === 'diamond' ? 'transparent' : fill,
      border: kind === 'diamond' ? 'none' : `2px solid ${stroke}`,
      borderRadius: kind === 'ellipse' ? '50%' : kind === 'round' ? Math.min(it.w, it.h) * 0.18 : 2
    }}>
      {kind === 'diamond' && (
        <svg className='diamond' viewBox='0 0 100 100' preserveAspectRatio='none'>
          <polygon points='50,1 99,50 50,99 1,50' fill={fill} stroke={stroke} strokeWidth={2} vectorEffect='non-scaling-stroke' />
        </svg>
      )}
      <EditableText it={it} style={{ fontSize: it.fontSize ?? 18, color: it.color, textAlign: it.align ?? 'center' }} />
    </div>
  )
}

function Frame ({ it }: { it: Item }) {
  const pattern = it.pattern ?? 'none'
  return (
    <div className='frame' style={{
      background: it.fill ?? '#ffffff',
      backgroundImage: PATTERNS[pattern],
      backgroundSize: pattern === 'lines' ? '100% 32px' : '24px 24px',
      borderRadius: it.radius ?? 0
    }} />
  )
}

function CardActions ({ it }: { it: Item }) {
  return (
    <div className='card-actions' data-nodrag>
      <button title='Aperçu' onClick={() => ui.set({ preview: { url: it.url!, kind: it.type === 'video' ? 'video' : 'link', embed: it.video?.embed } })}><Eye size={14} /></button>
      <button title='Actualiser l’aperçu' onClick={() => unfurlInto(it.id)}><RefreshCw size={14} /></button>
      <a title='Ouvrir dans un onglet' href={it.url} target='_blank' rel='noreferrer noopener'><ExternalLink size={14} /></a>
    </div>
  )
}

function LinkCard ({ it }: { it: Item }) {
  const m = it.meta
  const loading = it.status === 'loading'
  return (
    <div className={`card link ${loading ? 'loading' : ''}`}>
      {m?.image && <div className='thumb' style={{ backgroundImage: `url("${m.image}")` }} />}
      <div className='card-body'>
        <div className='site'>
          {m?.favicon && <img src={m.favicon} alt='' onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
          <span>{m?.siteName || hostOf(it.url ?? '')}</span>
        </div>
        <div className='title'>{loading ? 'Chargement de l’aperçu…' : (m?.title || it.url)}</div>
        {m?.description && <div className='desc'>{m.description}</div>}
        {it.status === 'error' && <div className='desc'>Aperçu indisponible — {it.url}</div>}
      </div>
      <CardActions it={it} />
    </div>
  )
}

function VideoCard ({ it }: { it: Item }) {
  const isPlaying = useStore(playing, (s) => s.id === it.id)
  const v = it.video
  const thumb = v?.thumb || it.meta?.image
  return (
    <div className='card video'>
      <div className='player'>
        {isPlaying && v
          ? (v.provider === 'file'
              ? <video src={v.embed} controls autoPlay data-nodrag />
              : <iframe src={v.embed} allow='autoplay; encrypted-media; fullscreen; picture-in-picture' allowFullScreen title={it.meta?.title ?? 'vidéo'} data-nodrag />)
          : (
            <button className='poster' data-nodrag style={{ backgroundImage: thumb ? `url("${thumb}")` : undefined }} onClick={() => playing.set({ id: it.id })} title='Lire ici'>
              <span className='play'><Play size={26} fill='currentColor' /></span>
            </button>
            )}
      </div>
      <div className='card-body'>
        <div className='site'><span>{it.meta?.siteName || v?.provider || hostOf(it.url ?? '')}</span></div>
        <div className='title'>{it.status === 'loading' ? 'Chargement…' : (it.meta?.title || it.url)}</div>
      </div>
      <CardActions it={it} />
    </div>
  )
}

export const ItemView = memo(function ItemView ({ it }: { it: Item }) {
  let body: React.ReactNode = null
  switch (it.type) {
    case 'frame': body = <Frame it={it} />; break
    case 'sticky': body = <Sticky it={it} />; break
    case 'shape': body = <Shape it={it} />; break
    case 'text': body = <EditableText it={it} className='free' style={{ fontSize: it.fontSize ?? 18, color: it.color ?? '#1f2937', textAlign: it.align ?? 'left' }} />; break
    case 'link': body = <LinkCard it={it} />; break
    case 'video': body = <VideoCard it={it} />; break
    case 'image': body = <img className='image' src={it.src} alt='' draggable={false} />; break
  }
  return (
    <div className={`item item-${it.type}${it.locked ? ' locked' : ''}`} data-id={it.id} style={{ left: it.x, top: it.y, width: it.w, height: it.h }}>
      {body}
    </div>
  )
})
