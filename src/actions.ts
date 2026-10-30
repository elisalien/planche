import {
  addItems, adoptInto, childrenOf, deleteItems, frameAt, frames, getItems, maxZ, moveBy, newId,
  selectionBounds, transact, undoManager, updateItems
} from './board'
import { itemsBounds } from './geometry'
import { select, ui, viewportCenterWorld, zoomToRect } from './store'
import type { Item, Point } from './types'

export const FRAME_PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: '16:9', label: 'Présentation 16:9', w: 1280, h: 720 },
  { id: '4:3', label: 'Présentation 4:3', w: 1024, h: 768 },
  { id: '1:1', label: 'Carré 1:1', w: 1080, h: 1080 },
  { id: 'a4', label: 'A4 portrait', w: 794, h: 1123 },
  { id: 'a4l', label: 'A4 paysage', w: 1123, h: 794 },
  { id: 'desktop', label: 'Desktop 1440', w: 1440, h: 900 },
  { id: 'tablet', label: 'Tablette', w: 834, h: 1194 },
  { id: 'mobile', label: 'Mobile', w: 390, h: 844 },
  { id: 'story', label: 'Story 9:16', w: 1080, h: 1920 },
  { id: 'card', label: 'Carte', w: 600, h: 400 }
]

export const STICKY_COLORS = ['#fde68a', '#fed7aa', '#fecaca', '#fbcfe8', '#ddd6fe', '#bfdbfe', '#a7f3d0', '#d9f99d', '#e5e7eb', '#ffffff']
export const FILL_COLORS = ['#ffffff', '#f8fafc', '#fef9c3', '#fee2e2', '#fce7f3', '#ede9fe', '#dbeafe', '#dcfce7', '#1f2937', 'transparent']
export const INK_COLORS = ['#1f2937', '#64748b', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777']

export function nextFrameOrder () {
  return frames().reduce((m, f) => Math.max(m, f.order ?? 0), 0) + 1
}

export function newFrame (r: { x: number; y: number; w: number; h: number }, preset?: string): Item {
  const n = frames().length + 1
  return { id: newId(), type: 'frame', ...r, z: 0, title: `Cadre ${n}`, pattern: 'none', radius: 0, order: nextFrameOrder(), preset }
}

/** Free space to the right of existing frames, so new boards line up like artboards. */
export function addFrameFromPreset (presetId: string) {
  const p = FRAME_PRESETS.find((f) => f.id === presetId) ?? FRAME_PRESETS[0]
  const fs = frames()
  let x: number; let y: number
  if (fs.length) {
    const last = fs[fs.length - 1]
    x = last.x + last.w + 120; y = last.y
  } else {
    const c = viewportCenterWorld(); x = c.x - p.w / 2; y = c.y - p.h / 2
  }
  const f = newFrame({ x, y, w: p.w, h: p.h }, p.id)
  addItems([f])
  select([f.id])
  zoomToRect(f)
}

/** Selected items plus frame children and connectors linking two of them. */
export function collectWithChildren (ids: string[]): Item[] {
  const all = getItems()
  const set = new Set(ids.filter((id) => all[id]))
  for (const id of [...set]) if (all[id].type === 'frame') childrenOf(id).forEach((c) => set.add(c.id))
  for (const it of Object.values(all)) {
    if (it.type === 'connector' && it.from?.id && it.to?.id && set.has(it.from.id) && set.has(it.to.id)) set.add(it.id)
  }
  return [...set].map((id) => all[id])
}

/** Deep-clone items with fresh ids, remapping parents and connector ends. */
export function cloneItems (list: Item[], dx: number, dy: number): Item[] {
  const map = new Map(list.map((it) => [it.id, newId()]))
  let z = maxZ()
  let order = nextFrameOrder()
  return list.map((it) => {
    const c: Item = { ...it, id: map.get(it.id)!, x: it.x + dx, y: it.y + dy }
    if (it.type !== 'frame') c.z = ++z
    else { c.order = order++; c.title = it.title }
    c.parentId = it.parentId && map.has(it.parentId) ? map.get(it.parentId)! : it.parentId ?? null
    if (it.type === 'connector') {
      const remap = (e: Item['from']) => e && (e.id && map.has(e.id) ? { ...e, id: map.get(e.id)! } : { ...e, id: e.id ?? null, x: e.x + dx, y: e.y + dy })
      c.from = remap(it.from); c.to = remap(it.to)
    }
    return c
  })
}

export function duplicateSelection () {
  const ids = ui.get().selected
  if (!ids.length) return
  const list = collectWithChildren(ids)
  // A lone duplicated frame goes beside the original, like a new artboard.
  const lone = ids.length === 1 && list[0]?.type === 'frame' ? list[0] : null
  const clones = cloneItems(list, lone ? lone.w + 80 : 24, lone ? 0 : 24)
  addItems(clones)
  const top = new Set(ids)
  select(clones.filter((_, i) => top.has(list[i].id)).map((c) => c.id))
}

const CLIP_PREFIX = 'planche-clip:'

export function copySelection (e: ClipboardEvent) {
  const ids = ui.get().selected
  if (!ids.length || !e.clipboardData) return false
  e.clipboardData.setData('text/plain', CLIP_PREFIX + JSON.stringify(collectWithChildren(ids)))
  e.preventDefault()
  return true
}

export function pasteClip (text: string, at: Point | null) {
  if (!text.startsWith(CLIP_PREFIX)) return false
  const list = JSON.parse(text.slice(CLIP_PREFIX.length)) as Item[]
  const b = itemsBounds(list, Object.fromEntries(list.map((i) => [i.id, i])))
  if (!b) return true
  const target = at ?? viewportCenterWorld()
  const clones = cloneItems(list, target.x - (b.x + b.w / 2), target.y - (b.y + b.h / 2))
  // Pasted roots land in whatever frame is under them.
  const ids = new Set(clones.map((c) => c.id))
  for (const c of clones) if (c.type !== 'frame' && c.type !== 'connector' && !(c.parentId && ids.has(c.parentId))) c.parentId = frameAt(c)?.id ?? null
  addItems(clones)
  select(clones.filter((c) => !(c.parentId && ids.has(c.parentId))).map((c) => c.id))
  return true
}

export function deleteSelection () {
  const ids = ui.get().selected.filter((id) => !getItems()[id]?.locked)
  if (!ids.length) return
  deleteItems(ids)
  select([])
}

export function reorder (front: boolean) {
  const all = getItems()
  const ids = ui.get().selected.filter((id) => all[id] && all[id].type !== 'frame')
  if (!ids.length) return
  const zs = Object.values(all).filter((i) => i.type !== 'frame').map((i) => i.z)
  let z = front ? Math.max(...zs) : Math.min(...zs)
  const patches: Record<string, Partial<Item>> = {}
  for (const id of ids) patches[id] = { z: front ? ++z : --z }
  updateItems(patches)
}

export function toggleLock () {
  const all = getItems()
  const ids = ui.get().selected
  const lock = !ids.every((id) => all[id]?.locked)
  updateItems(Object.fromEntries(ids.map((id) => [id, { locked: lock }])))
}

/** Wrap the selection in a new frame with padding (Shift+F). */
export function frameSelection () {
  const ids = ui.get().selected.filter((id) => getItems()[id]?.type !== 'frame')
  const b = selectionBounds(ids)
  if (!b) return
  const pad = 48
  const f = newFrame({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 })
  addItems([f])
  adoptInto(f.id)
  select([f.id])
}

/** Resize a frame around its content. */
export function fitFrameToContent (frameId: string) {
  const kids = childrenOf(frameId)
  const b = itemsBounds(kids, getItems())
  if (!b) return
  const pad = 48
  transact(() => {
    updateItems({ [frameId]: { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 } })
  })
}

export function nudge (dx: number, dy: number) {
  const all = getItems()
  const sel = new Set(ui.get().selected)
  const ids = [...sel].filter((id) => all[id] && !all[id].locked && !(all[id].parentId && sel.has(all[id].parentId!)))
  if (ids.length) moveBy(Object.fromEntries(ids.map((id) => [id, { dx, dy }])))
}

export function fitAll () {
  const all = Object.values(getItems())
  const b = itemsBounds(all, getItems())
  if (b) zoomToRect(b, 60, true, 1)
}

export function zoomToSelection () {
  const b = selectionBounds(ui.get().selected)
  if (b) zoomToRect(b, 80, true, 2)
}

export function undo () { undoManager.undo(); ui.set({ selected: ui.get().selected.filter((id) => getItems()[id]) }) }
export function redo () { undoManager.redo() }

export function selectAll () {
  select(Object.values(getItems()).filter((it) => !it.parentId || !getItems()[it.parentId]).map((i) => i.id))
}
