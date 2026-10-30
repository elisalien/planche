import { useEffect, useMemo, useRef } from 'react'
import {
  addItems, adoptInto, frameAt, getItems, maxZ, meta, moveBy, newId, reparent, sendCursor,
  undoManager, updateItem, useItems
} from '../board'
import { center, containsRect, intersects, itemRect, nearestSide, normRect, sidePoint, unionRects } from '../geometry'
import { snapRect } from '../snapping'
import { camera, screenToWorld, select, ui, useStore, viewportSize, zoomAt, zoomToRect, type Guide } from '../store'
import { newFrame } from '../actions'
import { ItemView, playing } from './ItemView'
import { Connectors } from './Connectors'
import { Overlay } from './Overlay'
import type { Item, Point, Rect, Side } from '../types'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'move'; start: Point; sStart: Point; ids: string[]; base: Rect; others: Rect[]; applied: Point; moved: boolean; clickId: string | null; wasSelected: boolean; shift: boolean }
  | { kind: 'resize'; id: string; handle: Handle; orig: Item; start: Point; others: Rect[] }
  | { kind: 'marquee'; start: Point; sStart: Point; additive: boolean; initial: string[]; frameId: string | null; moved: boolean }
  | { kind: 'create'; tool: 'frame' | 'shape' | 'sticky' | 'text'; start: Point }
  | { kind: 'connect' }
  | { kind: 'endpoint'; id: string; end: 'from' | 'to' }
  | { kind: 'pinch'; d0: number; z0: number; mid: Point; cam0: { x: number; y: number } }

/** Last known pointer position in world coordinates (paste / drop target). */
export const pointer = { world: null as Point | null }

const SNAP_PX = 6

function snapOpts (alt: boolean) {
  const s = ui.get()
  return { objects: s.snapObjects && !alt, grid: s.snapGrid && !alt ? s.gridSize : null }
}

/** Rects of items that are visible and not part of `exclude`, used as snap targets. */
function snapTargets (exclude: Set<string>): Rect[] {
  const all = getItems()
  const { w, h } = viewportSize()
  const a = screenToWorld(-200, -200); const b = screenToWorld(w + 200, h + 200)
  const view = normRect(a, b)
  const out: Rect[] = []
  for (const it of Object.values(all)) {
    if (exclude.has(it.id) || it.type === 'connector' || (it.parentId && exclude.has(it.parentId))) continue
    if (intersects(it, view)) out.push(it)
  }
  return out
}

/** Item (not connector) under a client point, ignoring overlay chrome. */
function itemAtPoint (cx: number, cy: number, skip?: string | null): string | null {
  for (const el of document.elementsFromPoint(cx, cy)) {
    const host = (el as HTMLElement).closest?.('[data-id],[data-frame-title]') as HTMLElement | null
    if (!host) continue
    const id = host.dataset.id ?? host.dataset.frameTitle!
    const it = getItems()[id]
    if (!it || it.type === 'connector' || id === skip) continue
    return id
  }
  return null
}

function sideNear (it: Item, p: Point, zoom: number): Side | 'auto' {
  const s = nearestSide(it, p)
  const sp = sidePoint(it, s)
  return Math.hypot(sp.x - p.x, sp.y - p.y) * zoom < 18 ? s : 'auto'
}

export function Canvas () {
  const items = useItems()
  const bg = useStore(meta, (m) => m.bg)
  const vpRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const space = useRef(false)
  const touches = useRef(new Map<number, Point>())

  // Camera is applied straight to the DOM so panning never re-renders items.
  useEffect(() => {
    const apply = () => {
      const c = camera.get()
      const s = ui.get()
      const w = worldRef.current; const vp = vpRef.current
      if (w) w.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.zoom})`
      if (vp) {
        let g = s.gridSize * c.zoom
        while (g < 14) g *= 5
        vp.style.backgroundImage = s.showGrid ? 'radial-gradient(circle, var(--grid-dot) 1.1px, transparent 1.3px)' : 'none'
        vp.style.backgroundSize = `${g}px ${g}px`
        vp.style.backgroundPosition = `${c.x - g / 2}px ${c.y - g / 2}px`
        vp.classList.toggle('lod-low', c.zoom < 0.35)
        vp.classList.toggle('lod-mini', c.zoom < 0.12)
      }
    }
    apply()
    const u1 = camera.subscribe(apply); const u2 = ui.subscribe(apply)
    return () => { u1(); u2() }
  }, [])

  // Stop inline videos when zoomed far out (keeps big boards smooth).
  useEffect(() => camera.subscribe(() => { if (camera.get().zoom < 0.25 && playing.get().id) playing.set({ id: null }) }), [])

  const { frameList, connList, otherList } = useMemo(() => {
    const frameList: Item[] = []; const connList: Item[] = []; const otherList: Item[] = []
    for (const it of Object.values(items)) {
      if (it.type === 'frame') frameList.push(it)
      else if (it.type === 'connector') connList.push(it)
      else otherList.push(it)
    }
    frameList.sort((a, b) => b.w * b.h - a.w * a.h)
    otherList.sort((a, b) => a.z - b.z)
    connList.sort((a, b) => a.z - b.z)
    return { frameList, connList, otherList }
  }, [items])

  // Wheel: zoom around the cursor or pan, depending on device and settings.
  useEffect(() => {
    const vp = vpRef.current!
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-scroll]')) return
      e.preventDefault()
      if (ui.get().presenting !== null) return
      const r = vp.getBoundingClientRect()
      const sx = e.clientX - r.left; const sy = e.clientY - r.top
      const mode = ui.get().wheelMode
      const mouseLike = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY))
      const zoom = e.ctrlKey || e.metaKey || (!e.shiftKey && (mode === 'zoom' || (mode === 'auto' && mouseLike)))
      const c = camera.get()
      if (zoom) {
        const k = e.ctrlKey && !mouseLike ? 0.012 : 0.0018
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
        zoomAt(sx, sy, c.zoom * Math.exp(-dy * k))
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
        camera.set({ x: c.x - dx, y: c.y - dy })
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [])

  // Space = temporary hand tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return
      e.preventDefault()
      if (!space.current) { space.current = true; vpRef.current?.classList.add('space') }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') { space.current = false; vpRef.current?.classList.remove('space') }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = vpRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function startMove (p: Point, s: Point, clickId: string | null, wasSelected: boolean, shift: boolean) {
    const all = getItems()
    const sel = new Set(ui.get().selected)
    const ids = [...sel].filter((id) => all[id] && !all[id].locked && !(all[id].parentId && sel.has(all[id].parentId!)))
    if (!ids.length) return
    const base = unionRects(ids.map((id) => itemRect(all[id], all)))!
    undoManager.stopCapturing()
    drag.current = { kind: 'move', start: p, sStart: s, ids, base, others: snapTargets(new Set(ids)), applied: { x: 0, y: 0 }, moved: false, clickId, wasSelected, shift }
  }

  function pick (id: string, shift: boolean) {
    const sel = ui.get().selected
    const was = sel.includes(id)
    if (shift) select(was ? sel.filter((x) => x !== id) : [...sel, id])
    else if (!was) select([id])
    return was
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement
    if (ui.get().presenting !== null) return
    if (t.closest('[data-nodrag]')) return
    const vp = vpRef.current!
    const s = local(e)
    const p = screenToWorld(s.x, s.y)
    const editing = ui.get().editing
    if (editing) (document.activeElement as HTMLElement | null)?.blur?.()

    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, s)
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()]
        const c = camera.get()
        drag.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: c.zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam0: { x: c.x, y: c.y } }
        ui.set({ marquee: null, guides: [] })
        return
      }
    }

    vp.setPointerCapture(e.pointerId)
    const tool = ui.get().tool
    if (e.button === 1 || (e.button === 0 && (space.current || tool === 'hand'))) {
      const c = camera.get()
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: c.x, cy: c.y }
      vp.classList.add('panning')
      return
    }
    if (e.button !== 0) return

    const all = getItems()
    const itemEl = t.closest('[data-id]') as HTMLElement | null
    const titleEl = t.closest('[data-frame-title]') as HTMLElement | null
    const handle = (t.closest('[data-handle]') as HTMLElement | null)?.dataset.handle as Handle | undefined
    const anchorEl = t.closest('[data-anchor]') as HTMLElement | null
    const endpointEl = t.closest('[data-endpoint]') as HTMLElement | null

    if (tool === 'frame' || tool === 'shape' || tool === 'sticky' || tool === 'text') {
      drag.current = { kind: 'create', tool, start: p }
      return
    }

    const beginConnect = (fromId: string | null, side: Side | 'auto') => {
      const from = fromId ? center(all[fromId]) : p
      ui.set({ connecting: { fromId, fromAnchor: side, from, to: p, hoverId: null } })
      drag.current = { kind: 'connect' }
    }

    if (tool === 'connector') {
      const id = titleEl?.dataset.frameTitle ?? itemEl?.dataset.id ?? null
      beginConnect(id && all[id]?.type !== 'connector' ? id : null, 'auto')
      return
    }

    if (handle) {
      const id = ui.get().selected[0]
      const orig = all[id]
      if (orig) {
        undoManager.stopCapturing()
        drag.current = { kind: 'resize', id, handle, orig, start: p, others: snapTargets(new Set([id])) }
      }
      return
    }
    if (endpointEl) {
      undoManager.stopCapturing()
      drag.current = { kind: 'endpoint', id: endpointEl.dataset.connector!, end: endpointEl.dataset.endpoint as 'from' | 'to' }
      return
    }
    if (anchorEl) {
      beginConnect(anchorEl.dataset.anchorId!, anchorEl.dataset.anchor as Side)
      return
    }
    if (titleEl) {
      const id = titleEl.dataset.frameTitle!
      const was = pick(id, e.shiftKey)
      startMove(p, s, id, was, e.shiftKey)
      return
    }
    if (itemEl) {
      const id = itemEl.dataset.id!
      const it = all[id]
      if (!it) return
      if (it.type === 'frame' && !ui.get().selected.includes(id)) {
        drag.current = { kind: 'marquee', start: p, sStart: s, additive: e.shiftKey, initial: ui.get().selected, frameId: id, moved: false }
        return
      }
      const was = pick(id, e.shiftKey)
      startMove(p, s, id, was, e.shiftKey)
      return
    }
    if (!e.shiftKey) select([])
    drag.current = { kind: 'marquee', start: p, sStart: s, additive: e.shiftKey, initial: e.shiftKey ? ui.get().selected : [], frameId: null, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const s = local(e)
    const p = screenToWorld(s.x, s.y)
    pointer.world = p
    sendCursor(p)
    const d = drag.current
    const zoom = camera.get().zoom

    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, s)

    if (!d) {
      const t = e.target as HTMLElement
      const host = t.closest('[data-anchor-id],[data-frame-title],[data-id]') as HTMLElement | null
      let id = host ? (host.dataset.anchorId ?? host.dataset.frameTitle ?? host.dataset.id ?? null) : null
      if (id && (getItems()[id]?.type === 'connector' || getItems()[id]?.locked)) id = null
      if (id !== ui.get().hoverId) ui.set({ hoverId: id })
      return
    }

    switch (d.kind) {
      case 'pinch': {
        const pts = [...touches.current.values()]
        if (pts.length < 2) return
        const [a, b] = pts
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        camera.set({ x: d.cam0.x + mid.x - d.mid.x, y: d.cam0.y + mid.y - d.mid.y, zoom: d.z0 })
        zoomAt(mid.x, mid.y, d.z0 * dist / d.d0)
        return
      }
      case 'pan': {
        camera.set({ x: d.cx + e.clientX - d.sx, y: d.cy + e.clientY - d.sy })
        return
      }
      case 'move': {
        if (!d.moved && Math.hypot(s.x - d.sStart.x, s.y - d.sStart.y) < 3) return
        if (!d.moved) { d.moved = true; ui.set({ dragging: true, hoverId: null }) }
        let dx = p.x - d.start.x; let dy = p.y - d.start.y
        const r = { ...d.base, x: d.base.x + dx, y: d.base.y + dy }
        const snap = snapRect(r, d.others, SNAP_PX / zoom, snapOpts(e.altKey))
        dx += snap.dx; dy += snap.dy
        const ddx = dx - d.applied.x; const ddy = dy - d.applied.y
        if (ddx || ddy) moveBy(Object.fromEntries(d.ids.map((id) => [id, { dx: ddx, dy: ddy }])))
        d.applied = { x: dx, y: dy }
        ui.set({ guides: snap.guides })
        return
      }
      case 'resize': {
        resize(d, p, e.shiftKey, e.altKey, zoom)
        return
      }
      case 'marquee': {
        if (!d.moved && Math.hypot(s.x - d.sStart.x, s.y - d.sStart.y) < 4) return
        d.moved = true
        const r = normRect(d.start, p)
        const all = getItems()
        const hit: string[] = []
        for (const it of Object.values(all)) {
          if (it.locked) continue
          const ir = itemRect(it, all)
          // Frames need to be fully enclosed so marquee inside a frame picks its content.
          if (it.type === 'frame' ? containsRect(r, ir) : intersects(r, ir)) hit.push(it.id)
        }
        select([...new Set([...d.initial, ...hit])])
        ui.set({ marquee: r })
        return
      }
      case 'create': {
        if (d.tool === 'frame' || d.tool === 'shape') ui.set({ marquee: normRect(d.start, p) })
        return
      }
      case 'connect': {
        const c = ui.get().connecting
        if (!c) return
        const hoverId = itemAtPoint(e.clientX, e.clientY, c.fromId)
        ui.set({ connecting: { ...c, to: p, hoverId } })
        return
      }
      case 'endpoint': {
        const conn = getItems()[d.id]
        if (!conn) return
        const other = d.end === 'from' ? conn.to : conn.from
        const hoverId = itemAtPoint(e.clientX, e.clientY, other?.id ?? null)
        const anchor = hoverId ? sideNear(getItems()[hoverId], p, zoom) : 'auto'
        updateItem(d.id, { [d.end]: hoverId ? { id: hoverId, anchor, x: p.x, y: p.y } : { id: null, x: p.x, y: p.y } })
        ui.set({ hoverId })
      }
    }
  }

  function resize (d: Extract<Drag, { kind: 'resize' }>, p: Point, shift: boolean, alt: boolean, zoom: number) {
    const o = d.orig; const h = d.handle
    let x1 = o.x; let y1 = o.y; let x2 = o.x + o.w; let y2 = o.y + o.h
    const dx = p.x - d.start.x; const dy = p.y - d.start.y
    if (h.includes('w')) x1 += dx
    if (h.includes('e')) x2 += dx
    if (h.includes('n')) y1 += dy
    if (h.includes('s')) y2 += dy
    const keepAspect = (o.type === 'image' || o.type === 'video') ? !shift : shift
    let guides: Guide[] = []
    if (!keepAspect || h.length === 1) {
      const lines = {
        x: h.includes('w') ? ['start' as const] : h.includes('e') ? ['end' as const] : [],
        y: h.includes('n') ? ['start' as const] : h.includes('s') ? ['end' as const] : []
      }
      const snap = snapRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, d.others, SNAP_PX / zoom, { ...snapOpts(alt), lines })
      if (h.includes('w')) x1 += snap.dx
      if (h.includes('e')) x2 += snap.dx
      if (h.includes('n')) y1 += snap.dy
      if (h.includes('s')) y2 += snap.dy
      guides = snap.guides
    }
    const min = 16
    if (x2 - x1 < min) { if (h.includes('w')) x1 = x2 - min; else x2 = x1 + min }
    if (y2 - y1 < min) { if (h.includes('n')) y1 = y2 - min; else y2 = y1 + min }
    if (keepAspect && h.length === 2) {
      const ratio = o.w / o.h
      let w = x2 - x1; let hh = y2 - y1
      if (w / hh > ratio) w = hh * ratio; else hh = w / ratio
      if (h.includes('w')) x1 = x2 - w; else x2 = x1 + w
      if (h.includes('n')) y1 = y2 - hh; else y2 = y1 + hh
    }
    updateItem(d.id, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, ...(o.type === 'frame' ? { preset: undefined } : {}) })
    ui.set({ guides, dragging: true })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId)
    const d = drag.current
    drag.current = null
    vpRef.current?.classList.remove('panning')
    if (!d) return
    const s = local(e)
    const p = screenToWorld(s.x, s.y)
    const zoom = camera.get().zoom
    switch (d.kind) {
      case 'move': {
        if (d.moved) {
          const all = getItems()
          reparent(d.ids.filter((id) => all[id]?.type !== 'frame'))
          undoManager.stopCapturing()
        } else if (d.clickId && d.wasSelected && !d.shift) {
          select([d.clickId])
        }
        break
      }
      case 'resize': {
        if (d.orig.type === 'frame') adoptInto(d.id)
        else reparent([d.id])
        undoManager.stopCapturing()
        break
      }
      case 'marquee': {
        if (!d.moved && d.frameId) pick(d.frameId, d.additive)
        break
      }
      case 'create': finishCreate(d.tool, d.start, p, zoom); break
      case 'connect': finishConnect(p, zoom); break
      case 'endpoint': ui.set({ hoverId: null }); undoManager.stopCapturing(); break
    }
    ui.set({ marquee: null, guides: [], dragging: false })
  }

  function finishCreate (tool: 'frame' | 'shape' | 'sticky' | 'text', start: Point, p: Point, zoom: number) {
    let r = normRect(start, p)
    const small = r.w * zoom < 8 && r.h * zoom < 8
    let it: Item
    const z = maxZ() + 1
    if (tool === 'frame') {
      if (small) r = { x: start.x - 400, y: start.y - 225, w: 800, h: 450 }
      it = newFrame(r)
    } else if (tool === 'shape') {
      if (small) r = { x: start.x - 80, y: start.y - 50, w: 160, h: 100 }
      it = { id: newId(), type: 'shape', ...r, z, shape: ui.get().shapeKind, fill: '#ffffff', stroke: '#1f2937', text: '', fontSize: 18 }
    } else if (tool === 'sticky') {
      it = { id: newId(), type: 'sticky', x: start.x - 100, y: start.y - 100, w: 200, h: 200, z, fill: ui.get().stickyColor, text: '' }
    } else {
      it = { id: newId(), type: 'text', x: start.x, y: start.y - 20, w: 260, h: 40, z, text: '', fontSize: 20, color: '#1f2937', align: 'left' }
    }
    if (it.type !== 'frame') it.parentId = frameAt(it)?.id ?? null
    addItems([it])
    if (it.type === 'frame') adoptInto(it.id)
    ui.set({ tool: 'select', selected: [it.id], editing: it.type === 'frame' ? null : it.id })
  }

  function finishConnect (p: Point, zoom: number) {
    const c = ui.get().connecting
    ui.set({ connecting: null, hoverId: null })
    if (!c) return
    const all = getItems()
    const toId = c.hoverId
    if (!toId && Math.hypot(p.x - c.from.x, p.y - c.from.y) * zoom < 24) return
    if (toId && toId === c.fromId) return
    const conn: Item = {
      id: newId(), type: 'connector', x: 0, y: 0, w: 0, h: 0, z: maxZ() + 1,
      from: c.fromId ? { id: c.fromId, anchor: c.fromAnchor, x: c.from.x, y: c.from.y } : { id: null, x: c.from.x, y: c.from.y },
      to: toId ? { id: toId, anchor: sideNear(all[toId], p, zoom), x: p.x, y: p.y } : { id: null, x: p.x, y: p.y },
      route: ui.get().defaultRoute, color: '#334155', width: 2, endArrow: true
    }
    addItems([conn])
    ui.set({ selected: [conn.id], tool: ui.get().tool === 'connector' ? 'connector' : 'select' })
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('[data-nodrag]') || ui.get().tool !== 'select') return
    const titleEl = t.closest('[data-frame-title]') as HTMLElement | null
    if (titleEl) { ui.set({ editing: titleEl.dataset.frameTitle!, selected: [titleEl.dataset.frameTitle!] }); return }
    const id = (t.closest('[data-id]') as HTMLElement | null)?.dataset.id
    const it = id ? getItems()[id] : null
    if (!it || it.locked) return
    switch (it.type) {
      case 'sticky': case 'text': case 'shape': case 'connector':
        ui.set({ editing: it.id, selected: [it.id] }); break
      case 'frame': zoomToRect(it, 40, true, 4); break
      case 'link': ui.set({ preview: { url: it.url!, kind: 'link' } }); break
      case 'video': playing.set({ id: it.id }); break
      case 'image': zoomToRect(it, 60, true, 4); break
    }
  }

  return (
    <div
      id='viewport'
      ref={vpRef}
      className={`viewport tool-${useStore(ui, (s) => s.tool)}${useStore(ui, (s) => s.dragging) ? ' dragging' : ''}`}
      style={{ backgroundColor: bg }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => sendCursor(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => { if (!(e.target as HTMLElement).closest('[data-nodrag]')) e.preventDefault() }}
    >
      <div className='world' ref={worldRef}>
        {frameList.map((it) => <ItemView key={it.id} it={it} />)}
        <Connectors items={items} list={connList} />
        {otherList.map((it) => <ItemView key={it.id} it={it} />)}
      </div>
      <Overlay />
    </div>
  )
}

export function isTyping (t: EventTarget | null) {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
}
