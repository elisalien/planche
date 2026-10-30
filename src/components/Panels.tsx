import { useEffect, useState } from 'react'
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Grid3x3, LayoutGrid, Magnet, Maximize, Minus, Plus, X
} from 'lucide-react'
import { frames, updateItems, useItems } from '../board'
import { camera, ui, useStore, zoomBy, zoomToRect, animateCamera, viewportSize } from '../store'
import { addFrameFromPreset, fitAll } from '../actions'
import { PATTERNS } from './ItemView'
import type { Item } from '../types'

export function FramesPanel () {
  useItems()
  const selected = useStore(ui, (s) => s.selected)
  const list = frames()

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const a = list[i]; const b = list[j]
    // Normalise orders first so swapping always works.
    const patches: Record<string, Partial<Item>> = {}
    list.forEach((f, k) => { patches[f.id] = { order: k } })
    patches[a.id] = { order: j }; patches[b.id] = { order: i }
    updateItems(patches)
  }

  return (
    <aside className='frames-panel panel' data-scroll>
      <header>
        <span>Cadres <small>{list.length}</small></span>
        <button className='icon' title='Nouveau cadre 16:9' onClick={() => addFrameFromPreset('16:9')}><Plus size={16} /></button>
      </header>
      {!list.length && <p className='empty'>Aucun cadre. Utilisez l’outil Cadre (F) pour créer des artboards, puis reliez-les avec des connecteurs.</p>}
      <ol>
        {list.map((f, i) => (
          <li key={f.id} className={selected.includes(f.id) ? 'active' : ''} onClick={() => { ui.set({ selected: [f.id] }); zoomToRect(f, 60, true, 4) }}>
            <span className='thumb' style={{ aspectRatio: `${f.w} / ${f.h}`, background: f.fill ?? 'var(--frame-bg)', backgroundImage: PATTERNS[f.pattern ?? 'none'], backgroundSize: '6px 6px' }} />
            <span className='name'>{i + 1}. {f.title || 'Sans titre'}</span>
            <span className='order' onClick={(e) => e.stopPropagation()}>
              <button className='icon' title='Monter' onClick={() => move(i, -1)}><ChevronUp size={14} /></button>
              <button className='icon' title='Descendre' onClick={() => move(i, 1)}><ChevronDown size={14} /></button>
            </span>
          </li>
        ))}
      </ol>
    </aside>
  )
}

export function ZoomBar () {
  const zoom = useStore(camera, (c) => c.zoom)
  const snapObjects = useStore(ui, (s) => s.snapObjects)
  const snapGrid = useStore(ui, (s) => s.snapGrid)
  const showGrid = useStore(ui, (s) => s.showGrid)
  const [open, setOpen] = useState(false)
  const setZoom = (z: number) => {
    const { w, h } = viewportSize()
    const c = camera.get()
    const wx = (w / 2 - c.x) / c.zoom; const wy = (h / 2 - c.y) / c.zoom
    animateCamera({ zoom: z, x: w / 2 - wx * z, y: h / 2 - wy * z }, 200)
    setOpen(false)
  }
  return (
    <div className='zoombar panel'>
      <button className={`tool${snapObjects ? ' active' : ''}`} title='Magnétisme objets / guides intelligents (Alt pour ignorer)' onClick={() => ui.set({ snapObjects: !snapObjects })}><Magnet size={16} /></button>
      <button className={`tool${snapGrid ? ' active' : ''}`} title='Aligner sur la grille' onClick={() => ui.set({ snapGrid: !snapGrid })}><LayoutGrid size={16} /></button>
      <button className={`tool${showGrid ? ' active' : ''}`} title='Afficher la grille' onClick={() => ui.set({ showGrid: !showGrid })}><Grid3x3 size={16} /></button>
      <span className='sep' />
      <button className='tool' title='Dézoomer (Ctrl+-)' onClick={() => zoomBy(1 / 1.25)}><Minus size={16} /></button>
      <button className='zoom-value' onClick={() => setOpen(!open)}>{Math.round(zoom * 100)}%</button>
      <button className='tool' title='Zoomer (Ctrl+=)' onClick={() => zoomBy(1.25)}><Plus size={16} /></button>
      <button className='tool' title='Tout afficher (Maj+1)' onClick={fitAll}><Maximize size={16} /></button>
      {open && (
        <div className='menu zoom-menu panel'>
          {[0.1, 0.25, 0.5, 1, 2, 4].map((z) => <button key={z} onClick={() => setZoom(z)}>{z * 100}%</button>)}
          <button onClick={() => { fitAll(); setOpen(false) }}>Tout afficher</button>
        </div>
      )}
    </div>
  )
}

export function PreviewModal () {
  const p = useStore(ui, (s) => s.preview)
  if (!p) return null
  const close = () => ui.set({ preview: null })
  const isFile = p.kind === 'video' && p.embed && /\.(mp4|webm|ogv|mov|m4v)(\?|$)/i.test(p.embed)
  return (
    <div className='modal-backdrop' onClick={close}>
      <div className={`modal ${p.kind}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <span className='url'>{p.url}</span>
          <a className='btn' href={p.url} target='_blank' rel='noreferrer noopener'><ExternalLink size={14} /> Ouvrir</a>
          <button className='icon' onClick={close}><X size={18} /></button>
        </header>
        {isFile
          ? <video src={p.embed} controls autoPlay />
          : <iframe src={p.kind === 'video' && p.embed ? p.embed : p.url} allow='autoplay; encrypted-media; fullscreen; picture-in-picture' allowFullScreen
              sandbox={p.kind === 'link' ? 'allow-scripts allow-same-origin allow-popups allow-forms' : undefined} title='aperçu' />}
        {p.kind === 'link' && <footer>Certains sites refusent l’affichage intégré : utilisez « Ouvrir » si la page reste blanche.</footer>}
      </div>
    </div>
  )
}

export function Presenter () {
  const idx = useStore(ui, (s) => s.presenting)
  useItems()
  const list = frames()
  useEffect(() => {
    if (idx === null) return
    const f = list[idx]
    if (f) zoomToRect(f, 24, true, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx])
  useEffect(() => {
    if (idx === null) return
    const onKey = (e: KeyboardEvent) => {
      const n = list.length
      if (e.key === 'Escape') ui.set({ presenting: null })
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) ui.set({ presenting: Math.min(n - 1, idx + 1) })
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) ui.set({ presenting: Math.max(0, idx - 1) })
      else return
      e.preventDefault(); e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [idx, list.length])
  if (idx === null) return null
  const f = list[idx]
  return (
    <div className='presenter panel'>
      <button className='tool' onClick={() => ui.set({ presenting: Math.max(0, idx - 1) })}><ChevronLeft size={18} /></button>
      <span>{idx + 1} / {list.length} — {f?.title}</span>
      <button className='tool' onClick={() => ui.set({ presenting: Math.min(list.length - 1, idx + 1) })}><ChevronRight size={18} /></button>
      <button className='tool' title='Quitter (Échap)' onClick={() => ui.set({ presenting: null })}><X size={18} /></button>
    </div>
  )
}

export function Toast () {
  const t = useStore(ui, (s) => s.toast)
  return t ? <div className='toast'>{t}</div> : null
}
