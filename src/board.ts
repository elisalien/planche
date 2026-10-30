import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { Awareness } from 'y-protocols/awareness'
import { useSyncExternalStore } from 'react'
import { createStore, useStore } from './store'
import type { Item, Items } from './types'
import { contains, center, itemsBounds } from './geometry'

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
    if (u?.name) return u as { name: string; color: string }
  } catch { /* ignore */ }
  const u = { name: `Invité ${Math.floor(Math.random() * 900 + 100)}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] }
  localStorage.setItem('planche:user', JSON.stringify(u))
  return u
}
export let me = loadUser()

// ---------------------------------------------------------------- document

export const doc = new Y.Doc()
export const itemsMap = doc.getMap<Item>('items')
export const metaMap = doc.getMap<unknown>('meta')
export const undoManager = new Y.UndoManager([itemsMap, metaMap], { captureTimeout: 400 })

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
export interface BoardMeta { name: string; bg: string; ui: UiTheme; canvas: CanvasTheme }

export const DEFAULT_BG = '#f4f4f2'
export const meta = createStore<BoardMeta>({ name: 'Tableau sans titre', bg: DEFAULT_BG, ui: 'light', canvas: 'light' })
metaMap.observe(() => {
  const bg = (metaMap.get('bg') as string) || DEFAULT_BG
  // Boards created before themes only stored a background colour.
  const canvas = (metaMap.get('canvas') as CanvasTheme) || (bg !== DEFAULT_BG ? 'custom' : 'light')
  meta.set({
    name: (metaMap.get('name') as string) || 'Tableau sans titre',
    bg,
    ui: (metaMap.get('ui') as UiTheme) || 'light',
    canvas
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

export interface BoardEntry { id: string; name: string; updated: number }
export function recentBoards (): BoardEntry[] {
  try { return JSON.parse(localStorage.getItem('planche:boards') || '[]') } catch { return [] }
}
function rememberBoard () {
  const list = recentBoards().filter((b) => b.id !== boardId)
  list.unshift({ id: boardId, name: meta.get().name, updated: Date.now() })
  localStorage.setItem('planche:boards', JSON.stringify(list.slice(0, 50)))
}
rememberBoard()

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
  for (const id of ids) if (all[id]?.type === 'frame') childrenOf(id).forEach((c) => gone.add(c.id))
  for (const it of Object.values(all)) {
    if (it.type === 'connector' && ((it.from?.id && gone.has(it.from.id)) || (it.to?.id && gone.has(it.to.id)))) gone.add(it.id)
  }
  transact(() => gone.forEach((id) => itemsMap.delete(id)))
}

export function childrenOf (frameId: string): Item[] {
  return Object.values(snapshot).filter((it) => it.parentId === frameId)
}

export function frames (): Item[] {
  return Object.values(snapshot).filter((it) => it.type === 'frame')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.y - b.y || a.x - b.x)
}

/** Topmost frame whose bounds contain the item's center. */
export function frameAt (it: Item, exclude?: Set<string>): Item | null {
  if (it.type === 'frame' || it.type === 'connector') return null
  const c = center(it)
  let best: Item | null = null
  for (const f of Object.values(snapshot)) {
    if (f.type !== 'frame' || f.id === it.id || exclude?.has(f.id)) continue
    if (contains(f, c) && (!best || f.w * f.h < best.w * best.h)) best = f
  }
  return best
}

export function reparent (ids: string[]) {
  transact(() => {
    for (const id of ids) {
      const it = itemsMap.get(id)
      if (!it || it.type === 'frame' || it.type === 'connector') continue
      const parentId = frameAt(it)?.id ?? null
      if ((it.parentId ?? null) !== parentId) itemsMap.set(id, { ...it, parentId })
    }
  })
}

/** A frame adopts loose items whose center falls inside it (after create/resize). */
export function adoptInto (frameId: string) {
  const f = itemsMap.get(frameId)
  if (!f) return
  transact(() => {
    for (const it of Object.values(snapshot)) {
      if (it.type === 'frame' || it.type === 'connector') continue
      const inside = contains(f, center(it))
      if (inside && !it.parentId) itemsMap.set(it.id, { ...it, parentId: f.id })
      else if (!inside && it.parentId === f.id) itemsMap.set(it.id, { ...it, parentId: frameAt(it)?.id ?? null })
    }
  })
}

/** Move items by a world delta; frames carry their children, connectors their free ends. */
export function moveBy (deltas: Record<string, { dx: number; dy: number }>) {
  const all = snapshot
  const expanded: Record<string, { dx: number; dy: number }> = { ...deltas }
  for (const id in deltas) {
    if (all[id]?.type === 'frame') for (const c of childrenOf(id)) if (!expanded[c.id]) expanded[c.id] = deltas[id]
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
  return JSON.stringify({ format: 'planche', version: 1, name: meta.get().name, bg: meta.get().bg, ui: meta.get().ui, canvas: meta.get().canvas, items: Object.values(snapshot) }, null, 2)
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
    for (const it of data.items as Item[]) itemsMap.set(it.id, it)
  })
}
