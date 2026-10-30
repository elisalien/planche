import { useRef, useState } from 'react'
import {
  Circle, Diamond, Frame, Hand, Image as ImageIcon, Link2, MousePointer2, Redo2, Spline, Square, SquareRoundCorner,
  StickyNote, Type, Undo2
} from 'lucide-react'
import { ui, useStore, viewportCenterWorld, type Tool } from '../store'
import { FRAME_PRESETS, STICKY_COLORS, addFrameFromPreset, redo, undo } from '../actions'
import { createImageItem, createUrlItem, URL_RE } from '../media'
import type { ShapeKind } from '../types'

const SHAPES: { k: ShapeKind; icon: React.ReactNode; label: string }[] = [
  { k: 'rect', icon: <Square size={18} />, label: 'Rectangle' },
  { k: 'round', icon: <SquareRoundCorner size={18} />, label: 'Arrondi' },
  { k: 'ellipse', icon: <Circle size={18} />, label: 'Ellipse' },
  { k: 'diamond', icon: <Diamond size={18} />, label: 'Losange' }
]

function ToolButton ({ tool, icon, label, keyHint }: { tool: Tool; icon: React.ReactNode; label: string; keyHint: string }) {
  const active = useStore(ui, (s) => s.tool === tool)
  return (
    <button className={`tool${active ? ' active' : ''}`} title={`${label} (${keyHint})`} onClick={() => ui.set({ tool, connecting: null })}>
      {icon}
    </button>
  )
}

export function Toolbar () {
  const tool = useStore(ui, (s) => s.tool)
  const shapeKind = useStore(ui, (s) => s.shapeKind)
  const stickyColor = useStore(ui, (s) => s.stickyColor)
  const [flyout, setFlyout] = useState<null | 'frame' | 'shape' | 'sticky'>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const addLink = () => {
    const url = prompt('Coller un lien (page web, YouTube, Vimeo, Loom, .mp4…)')?.trim()
    if (!url) return
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`
    if (!URL_RE.test(full)) return
    createUrlItem(full, viewportCenterWorld())
  }

  return (
    <div className='toolbar panel' onPointerLeave={() => setFlyout(null)}>
      <ToolButton tool='select' icon={<MousePointer2 size={18} />} label='Sélection' keyHint='V' />
      <ToolButton tool='hand' icon={<Hand size={18} />} label='Main' keyHint='H / Espace' />
      <div className='sep' />
      <div className='tool-group' onPointerEnter={() => setFlyout('frame')}>
        <ToolButton tool='frame' icon={<Frame size={18} />} label='Cadre / artboard' keyHint='F' />
        {flyout === 'frame' && (
          <div className='flyout presets'>
            <div className='flyout-title'>Nouveau cadre</div>
            {FRAME_PRESETS.map((p) => (
              <button key={p.id} onClick={() => { addFrameFromPreset(p.id); setFlyout(null) }}>
                <span className='preset-box' style={{ aspectRatio: `${p.w} / ${p.h}` }} />
                <span>{p.label}</span><small>{p.w}×{p.h}</small>
              </button>
            ))}
            <div className='hint'>…ou dessinez un cadre libre sur le canevas.</div>
          </div>
        )}
      </div>
      <div className='tool-group' onPointerEnter={() => setFlyout('sticky')}>
        <ToolButton tool='sticky' icon={<StickyNote size={18} />} label='Post-it' keyHint='N' />
        {flyout === 'sticky' && (
          <div className='flyout swatches'>
            {STICKY_COLORS.map((c) => (
              <button key={c} className={`swatch${c === stickyColor ? ' active' : ''}`} style={{ background: c }} onClick={() => { ui.set({ stickyColor: c, tool: 'sticky' }); setFlyout(null) }} />
            ))}
          </div>
        )}
      </div>
      <ToolButton tool='text' icon={<Type size={18} />} label='Texte' keyHint='T' />
      <div className='tool-group' onPointerEnter={() => setFlyout('shape')}>
        <ToolButton tool='shape' icon={SHAPES.find((s) => s.k === shapeKind)!.icon} label='Forme' keyHint='R' />
        {flyout === 'shape' && (
          <div className='flyout row'>
            {SHAPES.map((s) => (
              <button key={s.k} title={s.label} className={`tool${shapeKind === s.k && tool === 'shape' ? ' active' : ''}`} onClick={() => { ui.set({ shapeKind: s.k, tool: 'shape' }); setFlyout(null) }}>{s.icon}</button>
            ))}
          </div>
        )}
      </div>
      <ToolButton tool='connector' icon={<Spline size={18} />} label='Connecteur' keyHint='L' />
      <div className='sep' />
      <button className='tool' title='Lien ou vidéo (ou collez une URL avec Ctrl+V)' onClick={addLink}><Link2 size={18} /></button>
      <button className='tool' title='Image' onClick={() => fileRef.current?.click()}><ImageIcon size={18} /></button>
      <input ref={fileRef} type='file' accept='image/*' hidden onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) createImageItem(f, viewportCenterWorld())
        e.target.value = ''
      }} />
      <div className='sep' />
      <button className='tool' title='Annuler (Ctrl+Z)' onClick={undo}><Undo2 size={18} /></button>
      <button className='tool' title='Rétablir (Ctrl+Maj+Z)' onClick={redo}><Redo2 size={18} /></button>
    </div>
  )
}
