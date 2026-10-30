import { useEffect, useRef } from 'react'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Frame as FrameIcon, Grid2x2, Lock
} from 'lucide-react'
import { hasAncestorIn, updateItem, usePeers, useItems } from '../board'
import { connectorEnds, connectorGeometry, facingSide, itemsBounds, sidePoint } from '../geometry'
import { camera, ui, useStore, viewportSize } from '../store'
import { align, distribute, tidy } from '../align'
import { frameSelection } from '../actions'
import type { Item, Point, Rect, Side } from '../types'

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

function handlePos (r: Rect, h: typeof HANDLES[number]) {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2
  return { x, y }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function FrameTitleInput ({ f }: { f: Item }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return (
    <input
      ref={ref} className='frame-title-input' data-nodrag defaultValue={f.title}
      onBlur={(e) => { updateItem(f.id, { title: e.target.value.trim() || f.title }); ui.set({ editing: null }) }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
    />
  )
}

export function Overlay () {
  const cam = useStore(camera, (c) => c)
  const s = useStore(ui, (x) => x)
  const items = useItems()
  const peers = usePeers()
  const { w: vw, h: vh } = viewportSize()
  const z = cam.zoom
  const P = (p: Point) => ({ x: p.x * z + cam.x, y: p.y * z + cam.y })
  const R = (r: Rect) => ({ x: r.x * z + cam.x, y: r.y * z + cam.y, w: r.w * z, h: r.h * z })
  const visible = (r: Rect, m = 40) => r.x < vw + m && r.x + r.w > -m && r.y < vh + m && r.y + r.h > -m

  const frames = Object.values(items).filter((i) => i.type === 'frame')
  const selItems = s.selected.map((id) => items[id]).filter(Boolean)
  const bounds = itemsBounds(selItems, items)
  const single = selItems.length === 1 ? selItems[0] : null
  const resizable = single && single.type !== 'connector' && !single.locked
  const overview = clamp((0.32 - z) / 0.1, 0, 1)

  // Anchors of the hovered (or connection target) item.
  const anchorId = s.connecting ? s.connecting.hoverId : (!s.dragging && (s.tool === 'select' || s.tool === 'connector') ? s.hoverId : null)
  const anchorItem = anchorId ? items[anchorId] : null

  let preview: { d: string } | null = null
  if (s.connecting) {
    const c = s.connecting
    const fromIt = c.fromId ? items[c.fromId] : null
    const target = c.hoverId ? items[c.hoverId] : null
    const toP = target ? sidePoint(target, facingSide(target, c.from)) : c.to
    const fromSide = fromIt ? (c.fromAnchor === 'auto' ? facingSide(fromIt, toP) : c.fromAnchor) : null
    const a = fromIt && fromSide ? sidePoint(fromIt, fromSide) : c.from
    const b = target ? sidePoint(target, facingSide(target, a)) : c.to
    const norm = (sd: Side | null) => sd ? ({ top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } })[sd] : null
    const g = connectorGeometry(P(a), P(b), norm(fromSide), target ? norm(facingSide(target, a)) : null, s.defaultRoute)
    preview = { d: g.d }
  }

  let endpoints: { from: Point; to: Point } | null = null
  if (single?.type === 'connector') {
    const e = connectorEnds(single, items)
    endpoints = { from: P(e.a), to: P(e.b) }
  }

  const multi = selItems.filter((i) => i.type !== 'connector').length >= 2
  const bs = bounds ? R(bounds) : null

  return (
    <div className='overlay'>
      {/* Frame titles: constant screen size, truncated to the frame width, big overview labels when far away. */}
      {frames.map((f) => {
        const r = R(f)
        if (!visible(r, 60) || f.hideTitle || (s.focus && f.id !== s.focus && !hasAncestorIn(f.id, new Set([s.focus])))) return null
        const label = f.title || 'Sans titre'
        const editing = s.editing === f.id
        const sel = s.selected.includes(f.id)
        return (
          <div key={f.id}>
            {(r.w >= 36 || editing) && overview < 1 && (
              <div
                className={`frame-title${sel ? ' selected' : ''}${r.w < 110 ? ' compact' : ''}`}
                data-frame-title={f.id}
                style={{ left: r.x, top: r.y - (r.w < 110 ? 18 : 24), maxWidth: Math.max(r.w, editing ? 180 : 0), opacity: 1 - overview }}
                title={label}
              >
                {editing ? <FrameTitleInput f={f} /> : <span className='label'>{label}</span>}
                {sel && r.w > 160 && <span className='dims'>{Math.round(f.w)} × {Math.round(f.h)}</span>}
              </div>
            )}
            {overview > 0 && r.w > 28 && r.h > 18 && (
              <div className='frame-overview' style={{ left: r.x, top: r.y, width: r.w, height: r.h, opacity: overview }}>
                <span
                  data-frame-title={f.id}
                  style={{ fontSize: clamp(Math.min(r.w / (label.length * 0.62 + 1.5), r.h * 0.3), 8, 44) }}
                >{label}</span>
              </div>
            )}
          </div>
        )
      })}

      <svg className='overlay-svg'>
        {/* Remote selections */}
        {peers.map((p) => (p.selection ?? []).map((id) => {
          const it = items[id]
          if (!it || it.type === 'connector') return null
          const r = R(it)
          return <rect key={`${p.clientId}-${id}`} x={r.x - 3} y={r.y - 3} width={r.w + 6} height={r.h + 6} fill='none' stroke={p.user.color} strokeWidth={2} rx={3} />
        }))}

        {/* Hover outline */}
        {s.hoverId && !s.selected.includes(s.hoverId) && items[s.hoverId] && items[s.hoverId].type !== 'frame' && (() => {
          const r = R(items[s.hoverId!])
          return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill='none' stroke='#3b82f6' strokeWidth={1.5} rx={2} />
        })()}

        {/* Selection outlines */}
        {selItems.length > 1 && selItems.filter((i) => i.type !== 'connector').map((it) => {
          const r = R(it)
          return <rect key={it.id} x={r.x} y={r.y} width={r.w} height={r.h} fill='none' stroke='#3b82f6' strokeOpacity={0.6} strokeWidth={1} />
        })}
        {bs && !(single?.type === 'connector') && (
          <rect x={bs.x} y={bs.y} width={bs.w} height={bs.h} fill='none' stroke='#3b82f6' strokeWidth={1.5} strokeDasharray={selItems.length > 1 ? '5 4' : undefined} />
        )}

        {/* Snapping guides */}
        {s.guides.map((g, i) => {
          const a = P({ x: g.x1, y: g.y1 }); const b = P({ x: g.x2, y: g.y2 })
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className='guide' />
        })}

        {/* Marquee / creation preview */}
        {s.marquee && (() => {
          const r = R(s.marquee)
          return <rect x={r.x} y={r.y} width={r.w} height={r.h} className={s.tool === 'select' ? 'marquee' : 'create-preview'} />
        })()}

        {/* Connection being drawn */}
        {preview && <path d={preview.d} className='connect-preview' />}
        {s.connecting?.hoverId && items[s.connecting.hoverId] && (() => {
          const r = R(items[s.connecting!.hoverId!])
          return <rect x={r.x - 2} y={r.y - 2} width={r.w + 4} height={r.h + 4} fill='rgba(59,130,246,.06)' stroke='#3b82f6' strokeWidth={2} rx={3} />
        })()}
      </svg>

      {/* Resize handles */}
      {resizable && bs && HANDLES.map((h) => {
        if (h.length === 1 && (bs.w < 40 || bs.h < 40)) return null
        const p = handlePos(bs, h)
        return <div key={h} className={`handle h-${h}`} data-handle={h} style={{ left: p.x, top: p.y }} />
      })}
      {single?.locked && bs && <div className='lock-badge' style={{ left: bs.x + bs.w, top: bs.y }}><Lock size={12} /></div>}

      {/* Connection anchors */}
      {anchorItem && anchorItem.type !== 'connector' && !anchorItem.locked && SIDES.map((side) => {
        const r = R(anchorItem)
        if (r.w < 16 || r.h < 16) return null
        const p = sidePoint(r, side)
        const off = 14
        const o = { top: [0, -off], right: [off, 0], bottom: [0, off], left: [-off, 0] }[side]
        return <div key={side} className='anchor' data-anchor={side} data-anchor-id={anchorItem.id} style={{ left: p.x + o[0], top: p.y + o[1] }} title='Glisser pour relier' />
      })}

      {/* Connector endpoints */}
      {endpoints && single && (['from', 'to'] as const).map((k) => (
        <div key={k} className={`endpoint${single[k]?.id ? ' attached' : ''}`} data-endpoint={k} data-connector={single.id} style={{ left: endpoints![k].x, top: endpoints![k].y }} />
      ))}

      {/* Floating alignment bar */}
      {multi && bs && !s.dragging && (
        <div className='align-bar' data-nodrag style={{ left: clamp(bs.x + bs.w / 2, 190, vw - 190), top: clamp(bs.y - 52, 8, vh - 50) }}>
          <button title='Aligner à gauche (Alt+A)' onClick={() => align(s.selected, 'left')}><AlignStartVertical size={16} /></button>
          <button title='Centrer horizontalement (Alt+H)' onClick={() => align(s.selected, 'hcenter')}><AlignCenterVertical size={16} /></button>
          <button title='Aligner à droite (Alt+D)' onClick={() => align(s.selected, 'right')}><AlignEndVertical size={16} /></button>
          <span className='sep' />
          <button title='Aligner en haut (Alt+W)' onClick={() => align(s.selected, 'top')}><AlignStartHorizontal size={16} /></button>
          <button title='Centrer verticalement (Alt+V)' onClick={() => align(s.selected, 'vcenter')}><AlignCenterHorizontal size={16} /></button>
          <button title='Aligner en bas (Alt+S)' onClick={() => align(s.selected, 'bottom')}><AlignEndHorizontal size={16} /></button>
          <span className='sep' />
          <button title='Répartir horizontalement' onClick={() => distribute(s.selected, 'horizontal')}><AlignHorizontalDistributeCenter size={16} /></button>
          <button title='Répartir verticalement' onClick={() => distribute(s.selected, 'vertical')}><AlignVerticalDistributeCenter size={16} /></button>
          <button title='Ranger en grille' onClick={() => tidy(s.selected)}><Grid2x2 size={16} /></button>
          <span className='sep' />
          <button title='Encadrer la sélection (Maj+F)' onClick={frameSelection}><FrameIcon size={16} /></button>
        </div>
      )}

      {/* Remote cursors */}
      {peers.map((p) => {
        if (!p.cursor) return null
        const c = P(p.cursor)
        if (c.x < -20 || c.y < -20 || c.x > vw + 20 || c.y > vh + 20) return null
        return (
          <div key={p.clientId} className='peer-cursor' style={{ left: c.x, top: c.y, color: p.user.color }}>
            <svg width='18' height='18' viewBox='0 0 18 18'><path d='M1 1 L1 15 L5 11 L8 17 L10.5 16 L7.5 10 L13 10 Z' fill='currentColor' stroke='#fff' strokeWidth='1.2' /></svg>
            <span style={{ background: p.user.color }}>{p.user.name}</span>
          </div>
        )
      })}
    </div>
  )
}
