import { getItems, hasAncestorIn, moveBy, reparent, updateItems } from './board'
import type { Item, Rect } from './types'

export type AlignOp = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
export type DistributeOp = 'horizontal' | 'vertical'

/** Movable, non-connector items; children whose frame is also selected follow the frame. */
function targets (ids: string[]): Item[] {
  const all = getItems()
  const set = new Set(ids)
  return ids.map((id) => all[id]).filter((it): it is Item =>
    !!it && it.type !== 'connector' && !it.locked && !hasAncestorIn(it.id, set))
}

function apply (deltas: Record<string, { dx: number; dy: number }>) {
  moveBy(deltas)
  reparent(Object.keys(deltas))
}

/**
 * Align items on each other. With a single item inside a frame,
 * aligns it relative to its frame instead.
 */
export function align (ids: string[], op: AlignOp) {
  const list = targets(ids)
  if (!list.length) return
  let ref: Rect
  if (list.length === 1) {
    const parent = list[0].parentId ? getItems()[list[0].parentId] : null
    if (!parent) return
    ref = parent
  } else {
    const x1 = Math.min(...list.map((i) => i.x)); const y1 = Math.min(...list.map((i) => i.y))
    const x2 = Math.max(...list.map((i) => i.x + i.w)); const y2 = Math.max(...list.map((i) => i.y + i.h))
    ref = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }
  const deltas: Record<string, { dx: number; dy: number }> = {}
  for (const it of list) {
    let dx = 0; let dy = 0
    switch (op) {
      case 'left': dx = ref.x - it.x; break
      case 'hcenter': dx = ref.x + ref.w / 2 - (it.x + it.w / 2); break
      case 'right': dx = ref.x + ref.w - (it.x + it.w); break
      case 'top': dy = ref.y - it.y; break
      case 'vcenter': dy = ref.y + ref.h / 2 - (it.y + it.h / 2); break
      case 'bottom': dy = ref.y + ref.h - (it.y + it.h); break
    }
    if (dx || dy) deltas[it.id] = { dx, dy }
  }
  apply(deltas)
}

/** Equal gaps between items, keeping the outermost ones in place. */
export function distribute (ids: string[], op: DistributeOp) {
  const list = targets(ids)
  if (list.length < 3) return
  const h = op === 'horizontal'
  const sorted = [...list].sort((a, b) => (h ? a.x - b.x : a.y - b.y))
  const first = sorted[0]; const last = sorted[sorted.length - 1]
  const span = h ? last.x + last.w - first.x : last.y + last.h - first.y
  const sizes = sorted.reduce((s, it) => s + (h ? it.w : it.h), 0)
  const gap = (span - sizes) / (sorted.length - 1)
  let cursor = h ? first.x : first.y
  const deltas: Record<string, { dx: number; dy: number }> = {}
  for (const it of sorted) {
    const d = cursor - (h ? it.x : it.y)
    if (Math.abs(d) > 0.01) deltas[it.id] = h ? { dx: d, dy: 0 } : { dx: 0, dy: d }
    cursor += (h ? it.w : it.h) + gap
  }
  apply(deltas)
}

/** Arrange items in a tidy grid (reading order), starting at the selection's top-left. */
export function tidy (ids: string[], gap = 24) {
  const list = targets(ids)
  if (list.length < 2) return
  const sorted = [...list].sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x))
  const cols = Math.ceil(Math.sqrt(sorted.length))
  const cw = Math.max(...sorted.map((i) => i.w))
  const x0 = Math.min(...sorted.map((i) => i.x)); const y0 = Math.min(...sorted.map((i) => i.y))
  const deltas: Record<string, { dx: number; dy: number }> = {}
  let y = y0
  for (let r = 0; r * cols < sorted.length; r++) {
    const row = sorted.slice(r * cols, r * cols + cols)
    const rh = Math.max(...row.map((i) => i.h))
    row.forEach((it, c) => { deltas[it.id] = { dx: x0 + c * (cw + gap) - it.x, dy: y - it.y } })
    y += rh + gap
  }
  apply(deltas)
}

/** Make all items share the first item's width/height. */
export function matchSize (ids: string[], dim: 'w' | 'h') {
  const list = targets(ids)
  if (list.length < 2) return
  const v = list[0][dim]
  const patches: Record<string, Partial<Item>> = {}
  for (const it of list.slice(1)) patches[it.id] = { [dim]: v }
  updateItems(patches)
}
