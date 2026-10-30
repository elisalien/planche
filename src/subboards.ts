// Sub-boards: a board card on the canvas links to a separate board document.
// The child records its parent (for the breadcrumb) and keeps the card's
// title and preview up to date while it is open.

import * as Y from 'yjs'
import {
  addItems, boardId, frameAt, getItem, getItems, maxZ, meta, metaMap, newId, stylesMap, subscribeItems, transact,
  updateItem, withBoardDoc, itemsMap
} from './board'
import { collectWithChildren } from './actions'
import { itemsBounds } from './geometry'
import { select, toast, ui, zoomToRect } from './store'
import type { BoardSummary, Item, Point } from './types'

export const CARD_W = 320
export const CARD_H = 220

export function summarize (list: Item[]): BoardSummary {
  const all = Object.fromEntries(list.map((i) => [i.id, i]))
  const placed = list.filter((i) => i.type !== 'connector')
  const framesOnly = placed.filter((i) => i.type === 'frame')
  // Frames first so the items drawn on top of them stay visible in the mini map.
  const shown = [...framesOnly, ...placed.filter((i) => i.type !== 'frame')].slice(0, 60)
  const b = itemsBounds(shown, all)
  const boxes = b
    ? shown.map((i) => ({
      x: (i.x - b.x) / Math.max(b.w, 1), y: (i.y - b.y) / Math.max(b.h, 1),
      w: i.w / Math.max(b.w, 1), h: i.h / Math.max(b.h, 1),
      fill: i.type === 'sticky' ? i.fill ?? '#fde68a' : i.fill, frame: i.type === 'frame'
    }))
    : []
  return { count: placed.length, frames: framesOnly.length, boxes, updated: Date.now() }
}

function translate (it: Item, dx: number, dy: number): Item {
  if (it.type !== 'connector') return { ...it, x: it.x + dx, y: it.y + dy }
  const move = (e: Item['from']) => e && (e.id ? e : { ...e, x: e.x + dx, y: e.y + dy })
  return { ...it, from: move(it.from), to: move(it.to) }
}

function childMeta (m: Y.Map<unknown>, name: string) {
  const cur = meta.get()
  m.set('name', name)
  m.set('parent', { id: boardId, name: cur.name })
  m.set('ancestors', [...cur.ancestors, { id: boardId, name: cur.name }])
  // A sub-board starts with its parent's look.
  m.set('ui', cur.ui)
  m.set('canvas', cur.canvas)
  m.set('bg', cur.bg)
}

/** New empty sub-board with its card at `at`. */
export async function createSubBoard (at: Point) {
  const childId = newId(12)
  const name = 'Nouveau board'
  ui.set({ tool: 'select' })
  await withBoardDoc(childId, ({ doc, meta: m }) => doc.transact(() => childMeta(m, name)))
  const card: Item = {
    id: newId(), type: 'board', boardRef: childId, title: name, fill: '#6366f1',
    x: at.x - CARD_W / 2, y: at.y - CARD_H / 2, w: CARD_W, h: CARD_H, z: maxZ() + 1,
    summary: { count: 0, frames: 0, boxes: [], updated: Date.now() }
  }
  card.parentId = frameAt(card)?.id ?? null
  addItems([card])
  select([card.id])
}

/** Move a frame and everything in it to a new sub-board, leaving a linked card. */
export async function convertFrameToBoard (frameId: string) {
  const f = getItem(frameId)
  if (!f || f.type !== 'frame') return
  const moved = collectWithChildren([frameId])
  const movedIds = new Set(moved.map((i) => i.id))
  const childId = newId(12)
  const name = f.title || 'Sous-board'
  // The frame becomes the first artboard of the sub-board, at its origin.
  const childItems = moved.map((it) => {
    const t = translate(it, -f.x, -f.y)
    return it.id === frameId ? { ...t, parentId: null } : t
  })
  toast('Création du sous-board…')
  await withBoardDoc(childId, ({ doc, items, meta: m, styles }) => doc.transact(() => {
    childMeta(m, name)
    for (const it of childItems) items.set(it.id, it)
    stylesMap.forEach((st, id) => styles.set(id, st))
  }))

  const card: Item = {
    id: newId(), type: 'board', boardRef: childId, title: name, fill: '#6366f1',
    x: f.x, y: f.y, w: CARD_W, h: CARD_H, z: maxZ() + 1, parentId: f.parentId ?? null,
    summary: summarize(childItems)
  }
  transact(() => {
    // Links from outside now point at the card.
    for (const it of Object.values(getItems())) {
      if (it.type !== 'connector' || movedIds.has(it.id)) continue
      const from = it.from?.id && movedIds.has(it.from.id) ? { ...it.from, id: card.id, anchor: 'auto' as const } : it.from
      const to = it.to?.id && movedIds.has(it.to.id) ? { ...it.to, id: card.id, anchor: 'auto' as const } : it.to
      if (from !== it.from || to !== it.to) itemsMap.set(it.id, { ...it, from, to })
    }
    movedIds.forEach((id) => itemsMap.delete(id))
    itemsMap.set(card.id, card)
  })
  select([card.id])
  toast(`« ${name} » est maintenant un sous-board`)
}

/** Zoom onto the card, then open the sub-board. */
export function enterBoard (card: Item) {
  if (!card.boardRef) return
  zoomToRect(card, 20, true, 6)
  setTimeout(() => { location.hash = `#/b/${card.boardRef}` }, 320)
}

/** Rename the sub-board from its card (the child keeps the name in its own meta). */
export function renameSubBoard (card: Item, name: string) {
  updateItem(card.id, { title: name })
  if (card.boardRef) withBoardDoc(card.boardRef, ({ doc, meta: m }) => doc.transact(() => m.set('name', name)))
}

// ---------------------------------------------------------------- child → parent card sync

let timer = 0
let lastPushed = ''

/** While a sub-board is open, keep its card in the parent up to date. */
function schedulePush () {
  const parent = meta.get().parent
  if (!parent) return
  clearTimeout(timer)
  timer = window.setTimeout(() => {
    const name = meta.get().name
    const summary = summarize(Object.values(getItems()))
    const key = JSON.stringify([name, summary.count, summary.frames, summary.boxes])
    if (key === lastPushed) return
    lastPushed = key
    withBoardDoc(parent.id, ({ doc, items }) => doc.transact(() => {
      items.forEach((it, id) => {
        if (it.type === 'board' && it.boardRef === boardId) items.set(id, { ...it, title: name, summary })
      })
    })).catch(() => { lastPushed = '' })
  }, 2500)
}

subscribeItems(schedulePush)
metaMap.observe(schedulePush)
