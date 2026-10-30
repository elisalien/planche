import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { ExternalLink, Eye, LayoutGrid, Play, RefreshCw } from 'lucide-react'
import { updateItem, transact } from '../board'
import { createStore, ui, useStore } from '../store'
import { hostOf, unfurlInto } from '../media'
import { textBoxCss, textCss, textDefaults } from '../text'
import { useResolved } from '../textStyles'
import type { Item } from '../types'

/** Which video is playing inline is per-viewer state, not shared. */
export const playing = createStore<{ id: string | null }>({ id: null })

export const PATTERNS: Record<string, string> = {
  none: 'none',
  dots: 'radial-gradient(circle, var(--pattern) 1px, transparent 1.4px)',
  grid: 'linear-gradient(var(--pattern) 1px, transparent 1px), linear-gradient(90deg, var(--pattern) 1px, transparent 1px)',
  lines: 'linear-gradient(var(--pattern) 1px, transparent 1px)'
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
      if (it.type === 'text') patch.h = Math.max(it.h, Math.ceil(el.scrollHeight + 2 * (it.padding ?? textDefaults(it).padding)))
      updateItem(it.id, patch)
    })
    if (ui.get().editing === it.id) ui.set({ editing: null })
  }

  if (editing) {
    return (
      <div
        key='edit'
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
  return (
    // Distinct key: the browser mutates the editable node's DOM, so it must not be reused.
    <div key='view' className={`text ${className ?? ''}`} style={style}>
      {(it.text ?? '').split('\n').map((p, i) => <div key={i} className='para'>{p || '​'}</div>)}
    </div>
  )
}

/** Shrinks sticky text until it fits, like paper notes do. */
function useFitText (ref: React.RefObject<HTMLDivElement | null>, deps: unknown[], max: number, pad: number) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const t = el.querySelector('.text') as HTMLElement | null
    if (!t || t.classList.contains('editing')) return
    let size = max
    t.style.fontSize = `${size}px`
    while (size > 8 && (t.scrollHeight > el.clientHeight - pad * 2 || t.scrollWidth > el.clientWidth - pad * 2)) {
      size -= size > 20 ? 2 : 1
      t.style.fontSize = `${size}px`
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

function Sticky ({ it: raw }: { it: Item }) {
  const it = useResolved(raw)
  const ref = useRef<HTMLDivElement>(null)
  const pad = it.padding ?? textDefaults(it).padding
  useFitText(ref, [it.text, it.w, it.h, it.fontFamily, it.fontWeight, it.tracking, it.lineHeight, it.padding, it.spaceBefore, it.spaceAfter, it.textCase], it.fontSize ?? Math.round(Math.min(it.w, it.h) / 6.5), pad)
  return (
    <div ref={ref} className='sticky' style={{ background: it.fill ?? '#fde68a', ...textBoxCss(it) }}>
      <EditableText it={it} style={textCss(it)} />
    </div>
  )
}

function Shape ({ it: raw }: { it: Item }) {
  const it = useResolved(raw)
  const kind = it.shape ?? 'rect'
  const fill = it.fill ?? '#ffffff'
  const stroke = it.stroke ?? '#1f2937'
  return (
    <div className='shape' style={{
      background: kind === 'diamond' ? 'transparent' : fill,
      border: kind === 'diamond' ? 'none' : `2px solid ${stroke}`,
      borderRadius: kind === 'ellipse' ? '50%' : kind === 'round' ? Math.min(it.w, it.h) * 0.18 : 2,
      ...textBoxCss(it)
    }}>
      {kind === 'diamond' && (
        <svg className='diamond' viewBox='0 0 100 100' preserveAspectRatio='none'>
          <polygon points='50,1 99,50 50,99 1,50' fill={fill} stroke={stroke} strokeWidth={2} vectorEffect='non-scaling-stroke' />
        </svg>
      )}
      <EditableText it={it} style={{ fontSize: 18, ...textCss(it) }} />
    </div>
  )
}

function FreeText ({ it: raw }: { it: Item }) {
  const it = useResolved(raw)
  return (
    <div className='textbox' style={textBoxCss(it)}>
      <EditableText it={it} className='free' style={{ fontSize: 18, ...textCss(it, 'var(--canvas-ink)') }} />
    </div>
  )
}

function Frame ({ it }: { it: Item }) {
  const pattern = it.pattern ?? 'none'
  return (
    <div className='frame' style={{
      background: it.fill ?? 'var(--frame-bg)',
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

/** Card of a sub-board: title, mini map of its content, double click to enter. */
function BoardCard ({ it }: { it: Item }) {
  const s = it.summary
  const accent = it.fill ?? '#6366f1'
  return (
    <div className='board-card' style={{ ['--card-accent' as string]: accent }}>
      <div className='bc-map'>
        {s?.boxes.map((b, i) => (
          <span key={i} className={b.frame ? 'bc-frame' : 'bc-item'}
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${Math.max(b.w * 100, 2)}%`, height: `${Math.max(b.h * 100, 2)}%`, background: b.frame ? undefined : b.fill }} />
        ))}
        {!s?.count && <span className='bc-empty'>Board vide</span>}
      </div>
      <div className='bc-body'>
        <div className='bc-title'><LayoutGrid size={15} /> <span>{it.title || 'Sans titre'}</span></div>
        <div className='bc-meta'>{s ? `${s.count} élément${s.count > 1 ? 's' : ''} · ${s.frames} cadre${s.frames > 1 ? 's' : ''}` : ''}<span>Double-clic pour entrer</span></div>
      </div>
    </div>
  )
}

export const ItemView = memo(function ItemView ({ it, dim }: { it: Item; dim?: boolean }) {
  let body: React.ReactNode = null
  switch (it.type) {
    case 'frame': body = <Frame it={it} />; break
    case 'sticky': body = <Sticky it={it} />; break
    case 'shape': body = <Shape it={it} />; break
    case 'text': body = <FreeText it={it} />; break
    case 'link': body = <LinkCard it={it} />; break
    case 'video': body = <VideoCard it={it} />; break
    case 'image': body = <img className='image' src={it.src} alt='' draggable={false} />; break
    case 'board': body = <BoardCard it={it} />; break
  }
  return (
    <div className={`item item-${it.type}${it.locked ? ' locked' : ''}${dim ? ' dimmed' : ''}`} data-id={it.id} style={{ left: it.x, top: it.y, width: it.w, height: it.h }}>
      {body}
    </div>
  )
})
