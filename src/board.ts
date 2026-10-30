import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { Awareness } from 'y-protocols/awareness'
import { useSyncExternalStore } from 'react'
import { createStore, useStore } from './store'
import type { Item, Items, TextStyle } from './types'
import { contains, containsRect, center, itemsBounds } from './geometry'

// ---------------------------------------------------------------- identity

export function newId (len = 10) {
  const a = 'abcdefghijkmnopqrstuvwxyz23456789'
  let s = ''
  const r = crypto.getRandomValues(new Uint8Array(len))
  for (const b of r) s += a[b % a.length]
  return s
}

export function currentBoardId () {
  const m = location.hash.match(/^#\/?b\/([\w-]{3,64})/)
  if (m) return m[1]
  const id = newId(12)
  history.replaceState(null, '', `#/b/${id}`)
  return id
}

export const boardId = currentBoardId()
window.addEventListener('hashchange', () => {
  if (currentBoardId() !== boardId) location.reload()
})

const COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3']
function loadUser () {
  try {
    const u = JSON.parse(localStorage.getItem('planche:user') || 'null')
    // A stable id identifies the owner of personal styles.
    if (u?.name) {
      if (!u.id) { u.id = newId(12); localStorage.setItem('planche:user', JSON.stringify(u)) }
      return u as { id: string; name: string; color: string }
    }
  } catch { /* ignore */ }
  const u = { id: newId(12), name: `Invité ${Math.floor(Math.random() * 900 + 100)}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] }
  localStorage.setItem('planche:user', JSON.stringify(u))
  return u
}
export let me = loadUser()

// ---------------------------------------------------------------- document

export const doc = new Y.Doc()
export const itemsMap = doc.getMap<Item>('items')
export const metaMap = doc.getMap<unknown>('meta')
export const stylesMap = doc.getMap<TextStyle>('styles')
export const undoManager = new Y.UndoManager([itemsMap, metaMap, stylesMap], { captureTimeout: 400 })

export const awareness = new Awareness(doc)
awareness.setLocalStateField('user', me)

export const net = createStore<{ status: 'local' | 'connecting' | 'connected' | 'offline'; synced: boolean; server: string | null; loaded: boolean }>({
  status: 'local', synced: false, server: null, loaded: false
})

const idb = new IndexeddbPersistence(`planche-${boardId}`, doc)
idb.whenSynced.then(() => net.set({ loaded: true }))

function serverUrl (): string | null {
  const param = new URLSearchParams(location.search).get('server')
  if (param !== null) localStorage.setItem('planche:server', param)
  const custom = param ?? localStorage.getItem('planche:server')
  if (custom) return custom
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/yjs`
}

export let provider: WebsocketProvider | null = null

async function connect () {
  const url = serverUrl()
  if (!url) return
  // On a static host without the Planche server, stay local instead of retrying forever.
  if (url.includes(location.host)) {
    const ok = await fetch('/api/health').then((r) => r.ok).catch(() => false)
    if (!ok) { net.set({ status: 'local' }); return }
  }
  net.set({ status: 'connecting', server: url })
  provider = new WebsocketProvider(url, boardId, doc, { awareness })
  provider.on('status', ({ status }: { status: string }) => {
    net.set({ status: status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline' })
  })
  provider.on('sync', (synced: boolean) => net.set({ synced }))
}
connect()

export function setMe (patch: Partial<typeof me>) {
  me = { ...me, ...patch }
  localStorage.setItem('planche:user', JSON.stringify(me))
  awareness.setLocalStateField('user', me)
}

/**
 * Open another board's document (local copy + server when available), run `fn`
 * on it, give the changes time to reach the server, then close it.
 */
export async function withBoardDoc<T> (id: string, fn: (d: { doc: Y.Doc; items: Y.Map<Item>; meta: Y.Map<unknown>; styles: Y.Map<TextStyle> }) => T): Promise<T> {
  const d = new Y.Doc()
  const store = new IndexeddbPersistence(`planche-${id}`, d)
  await store.whenSynced
  let ws: WebsocketProvider | null = null
  if (provider) {
    const p = new WebsocketProvider(serverUrl()!, id, d, { awareness: new Awareness(d) })
    ws = p
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 4000)
      p.on('sync', (synced: boolean) => { if (synced) { clearTimeout(t); resolve() } })
    })
  }
  const out = fn({ doc: d, items: d.getMap<Item>('items'), meta: d.getMap<unknown>('meta'), styles: d.getMap<TextStyle>('styles') })
  await new Promise((r) => setTimeout(r, 700))
  ws?.destroy()
  await store.destroy()
  d.destroy()
  return out
}

// ---------------------------------------------------------------- snapshots

let snapshot: Items = {}
let version = 0
const listeners = new Set<() => void>()
function rebuild () {
  const next: Items = {}
  itemsMap.forEach((v, k) => { next[k] = v })
  snapshot = next
  version++
  listeners.forEach((l) => l())
}
itemsMap.observe(rebuild)
rebuild()

export function getItems () { return snapshot }
export function getItem (id: string): Item | undefined { return snapshot[id] }
export function subscribeItems (l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
export function useItems () { return useSyncExternalStore(subscribeItems, getItems) }
export function useItem (id: string | null | undefined) {
  return useSyncExternalStore(subscribeItems, () => (id ? snapshot[id] : undefined))
}
export function itemsVersion () { return version }

export type UiTheme = 'light' | 'dark'
export type CanvasTheme = 'light' | 'dark' | 'custom'
export interface BoardRef { id: string; name: string }
export interface BoardMeta { name: string; bg: string; ui: UiTheme; canvas: CanvasTheme; parent: BoardRef | null; ancestors: BoardRef[] }

export const DEFAULT_BG = '#f4f4f2'
export const meta = createStore<BoardMeta>({ name: 'Tableau sans titre', bg: DEFAULT_BG, ui: 'light', canvas: 'light', parent: null, ancestors: [] })
metaMap.observe(() => {
  const bg = (metaMap.get('bg') as string) || DEFAULT_BG
  // Boards created before themes only stored a background colour.
  const canvas = (metaMap.get('canvas') as CanvasTheme) || (bg !== DEFAULT_BG ? 'custom' : 'light')
  const parent = (metaMap.get('parent') as BoardRef) || null
  meta.set({
    name: (metaMap.get('name') as string) || 'Tableau sans titre',
    bg,
    ui: (metaMap.get('ui') as UiTheme) || 'light',
    canvas,
    parent,
    // Older sub-boards only know their direct parent.
    ancestors: (metaMap.get('ancestors') as BoardRef[]) || (parent ? [parent] : [])
  })
  rememberBoard()
})
export function setMeta<K extends keyof BoardMeta> (key: K, value: BoardMeta[K]) { doc.transact(() => metaMap.set(key, value)) }

function luminance (hex: string) {
  const m = hex.replace('#', '').match(/.{2}/g)
  if (!m || m.length < 3) return 1
  const [r, g, b] = m.map((h) => parseInt(h, 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Whether the canvas is dark, accounting for custom background colours. */
export function canvasIsDark (m: BoardMeta = meta.get()) {
  return m.canvas === 'dark' || (m.canvas === 'custom' && luminance(m.bg) < 0.45)
}
export function useMeta () { return useStore(meta, (m) => m) }

// ---------------------------------------------------------------- presence

export interface Peer {
  clientId: number
  user: { name: string; color: string }
  cursor?: { x: number; y: number } | null
  selection?: string[]
}

let peers: Peer[] = []
const peerListeners = new Set<() => void>()
awareness.on('change', () => {
  const list: Peer[] = []
  awareness.getStates().forEach((s, clientId) => {
    if (clientId !== doc.clientID && s.user) list.push({ clientId, ...(s as Omit<Peer, 'clientId'>) })
  })
  peers = list
  peerListeners.forEach((l) => l())
})
export function usePeers () {
  return useSyncExternalStore((l) => { peerListeners.add(l); return () => { peerListeners.delete(l) } }, () => peers)
}

let lastCursor = 0
export function sendCursor (p: { x: number; y: number } | null) {
  const now = performance.now()
  if (p && now - lastCursor < 40) return
  lastCursor = now
  awareness.setLocalStateField('cursor', p)
}

// ---------------------------------------------------------------- recent boards

// Local index of known boards (visited, or seen as sub-board cards). It lives
// only in this browser: the server never lists boards, so links stay private.

export interface BoardEntry {
  id: string
  name: string
  /** Last visit (0 = known but never opened here). */
  updated: number
  parent?: string | null
  fav?: boolean
}

const INDEX_KEY = 'planche:boards'
const indexStore = createStore<{ list: BoardEntry[] }>({ list: readIndex() })

function readIndex (): BoardEntry[] {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]') } catch { return [] }
}

function writeIndex (list: BoardEntry[]) {
  // Keep favourites and the most recently visited boards.
  const kept = [...list].sort((a, b) => Number(!!b.fav) - Number(!!a.fav) || b.updated - a.updated).slice(0, 300)
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(kept)) } catch { /* storage unavailable */ }
  indexStore.set({ list: kept })
}

function upsert (list: BoardEntry[], e: Partial<BoardEntry> & { id: string }) {
  const i = list.findIndex((b) => b.id === e.id)
  if (i < 0) list.push({ name: 'Sans titre', updated: 0, ...e })
  else list[i] = { ...list[i], ...Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)) }
}

export function useBoardIndex () { return useStore(indexStore, (s) => s.list) }
export function boardIndex () { return indexStore.get().list }

/** Boards visited in this browser, most recent first. */
export function recentBoards (): BoardEntry[] {
  return boardIndex().filter((b) => b.updated > 0).sort((a, b) => b.updated - a.updated)
}

export function toggleFavorite (id: string) {
  const list = [...boardIndex()]
  const cur = list.find((b) => b.id === id)
  upsert(list, { id, fav: !cur?.fav, name: cur?.name ?? (id === boardId ? meta.get().name : 'Sans titre') })
  writeIndex(list)
}

function rememberBoard () {
  const list = [...boardIndex()]
  const m = meta.get()
  upsert(list, { id: boardId, name: m.name, updated: Date.now(), parent: m.parent?.id ?? null })
  for (const a of m.ancestors) upsert(list, { id: a.id, name: a.name })
  writeIndex(list)
}
rememberBoard()

/** Sub-board cards on this board become known children in the index. */
let childTimer = 0
function registerChildren () {
  clearTimeout(childTimer)
  childTimer = window.setTimeout(() => {
    const list = [...boardIndex()]
    let changed = false
    for (const it of Object.values(snapshot)) {
      if (it.type !== 'board' || !it.boardRef) continue
      const cur = list.find((b) => b.id === it.boardRef)
      if (cur && cur.name === it.title && cur.parent === boardId) continue
      upsert(list, { id: it.boardRef, name: it.title || 'Sans titre', parent: boardId })
      changed = true
    }
    if (changed) writeIndex(list)
  }, 800)
}
listeners.add(registerChildren)

// ---------------------------------------------------------------- mutations

export function transact (fn: () => void) { doc.transact(fn) }

export function maxZ () {
  let z = 0
  for (const it of Object.values(snapshot)) if (it.type !== 'frame' && it.z > z) z = it.z
  return z
}

export function addItems (items: Item[]) {
  transact(() => items.forEach((it) => itemsMap.set(it.id, it)))
}

export function updateItem (id: string, patch: Partial<Item>) {
  const cur = itemsMap.get(id)
  if (cur) itemsMap.set(id, { ...cur, ...patch })
}

export function updateItems (patches: Record<string, Partial<Item>>) {
  transact(() => { for (const id in patches) updateItem(id, patches[id]) })
}

/** Deleting a frame deletes its content; connectors attached to deleted items go too. */
export function deleteItems (ids: string[]) {
  const all = snapshot
  const gone = new Set(ids)
  for (const id of ids) if (all[id]?.type === 'frame') descendantsOf(id).forEach((c) => gone.add(c.id))
  for (const it of Object.values(all)) {
    if (it.type === 'connector' && ((it.from?.id && gone.has(it.from.id)) || (it.to?.id && gone.has(it.to.id)))) gone.add(it.id)
  }
  transact(() => gone.forEach((id) => itemsMap.delete(id)))
}

export function childrenOf (frameId: string): Item[] {
  return Object.values(snapshot).filter((it) => it.parentId === frameId)
}

/** Everything nested inside a frame, at any depth. */
export function descendantsOf (frameId: string): Item[] {
  const out: Item[] = []
  const queue = [frameId]
  const seen = new Set(queue)
  while (queue.length) {
    const id = queue.shift()!
    for (const it of Object.values(snapshot)) {
      if (it.parentId === id && !seen.has(it.id)) { seen.add(it.id); out.push(it); queue.push(it.id) }
    }
  }
  return out
}

/** Frame ancestors of an item, nearest first. */
export function ancestorsOf (id: string): Item[] {
  const out: Item[] = []
  let cur = snapshot[id]?.parentId
  while (cur && snapshot[cur] && !out.some((a) => a.id === cur)) { out.push(snapshot[cur]); cur = snapshot[cur].parentId }
  return out
}

/** True when one of the item's ancestor frames is in `set`. */
export function hasAncestorIn (id: string, set: Set<string>) {
  return ancestorsOf(id).some((a) => set.has(a.id))
}

export function frames (): Item[] {
  return Object.values(snapshot).filter((it) => it.type === 'frame')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.y - b.y || a.x - b.x)
}

export interface FrameNode { frame: Item; depth: number; siblings: Item[] }

/** Frames in reading order: each frame followed by the frames nested in it. */
export function frameTree (): FrameNode[] {
  const all = frames()
  const out: FrameNode[] = []
  const walk = (parentId: string | null, depth: number) => {
    const siblings = all.filter((f) => (f.parentId ?? null) === parentId || (parentId === null && f.parentId && !snapshot[f.parentId]))
    for (const f of siblings) { out.push({ frame: f, depth, siblings }); walk(f.id, depth + 1) }
  }
  walk(null, 0)
  return out
}

/**
 * Frame that should contain an item: the smallest frame holding its center,
 * or, for a frame, the smallest larger frame holding it entirely (nesting).
 */
export function frameAt (it: Item, exclude?: Set<string>): Item | null {
  if (it.type === 'connector') return null
  const nested = it.type === 'frame'
  const c = center(it)
  const below = nested ? new Set(descendantsOf(it.id).map((d) => d.id)) : null
  let best: Item | null = null
  for (const f of Object.values(snapshot)) {
    if (f.type !== 'frame' || f.id === it.id || exclude?.has(f.id) || below?.has(f.id)) continue
    const fits = nested ? f.w * f.h > it.w * it.h && containsRect(f, it) : contains(f, c)
    if (fits && (!best || f.w * f.h < best.w * best.h)) best = f
  }
  return best
}

export function reparent (ids: string[]) {
  transact(() => {
    for (const id of ids) {
      const it = itemsMap.get(id)
      if (!it || it.type === 'connector') continue
      const parentId = frameAt(it)?.id ?? null
      if ((it.parentId ?? null) !== parentId) itemsMap.set(id, { ...it, parentId })
    }
  })
}

/** After a frame is created or resized, recompute which frame owns every item. */
export function adoptInto (_frameId?: string) {
  reparent(Object.keys(snapshot))
}

/** Move items by a world delta; frames carry their content, connectors their free ends. */
export function moveBy (deltas: Record<string, { dx: number; dy: number }>) {
  const all = snapshot
  const expanded: Record<string, { dx: number; dy: number }> = { ...deltas }
  for (const id in deltas) {
    if (all[id]?.type === 'frame') for (const c of descendantsOf(id)) if (!expanded[c.id]) expanded[c.id] = deltas[id]
  }
  transact(() => {
    for (const id in expanded) {
      const it = itemsMap.get(id)
      if (!it) continue
      const { dx, dy } = expanded[id]
      if (it.type === 'connector') {
        itemsMap.set(id, {
          ...it,
          from: it.from && !it.from.id ? { ...it.from, x: it.from.x + dx, y: it.from.y + dy } : it.from,
          to: it.to && !it.to.id ? { ...it.to, x: it.to.x + dx, y: it.to.y + dy } : it.to
        })
      } else {
        itemsMap.set(id, { ...it, x: it.x + dx, y: it.y + dy })
      }
    }
  })
}

export function selectionBounds (ids: string[]) {
  return itemsBounds(ids.map((id) => snapshot[id]).filter(Boolean), snapshot)
}

// ---------------------------------------------------------------- import / export

export function exportBoard () {
  return JSON.stringify({ format: 'planche', version: 1, name: meta.get().name, bg: meta.get().bg, ui: meta.get().ui, canvas: meta.get().canvas, styles: [...stylesMap.values()], items: Object.values(snapshot) }, null, 2)
}

export function importBoard (json: string, replace: boolean) {
  const data = JSON.parse(json)
  if (data.format !== 'planche' || !Array.isArray(data.items)) throw new Error('Fichier non reconnu')
  transact(() => {
    if (replace) {
      itemsMap.clear()
      if (data.name) metaMap.set('name', data.name)
      if (data.bg) metaMap.set('bg', data.bg)
      if (data.ui) metaMap.set('ui', data.ui)
      if (data.canvas) metaMap.set('canvas', data.canvas)
    }
    if (replace) stylesMap.clear()
    for (const st of (data.styles ?? []) as TextStyle[]) stylesMap.set(st.id, st)
    for (const it of data.items as Item[]) itemsMap.set(it.id, it)
  })
}
