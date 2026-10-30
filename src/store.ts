import { useSyncExternalStore } from 'react'
import type { Rect, Side, Route, ShapeKind } from './types'

export interface Store<T> {
  get: () => T
  set: (patch: Partial<T> | ((s: T) => Partial<T>)) => void
  subscribe: (l: () => void) => () => void
}

export function createStore<T extends object> (init: T): Store<T> {
  let state = init
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (patch) => {
      const p = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...p }
      listeners.forEach((l) => l())
    },
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l) } }
  }
}

/** Selectors must return stable values (primitives or stored references). */
export function useStore<T, S> (store: Store<T>, sel: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()))
}

// ---------------------------------------------------------------- camera

export interface Camera { x: number; y: number; zoom: number }
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 8
export const camera = createStore<Camera>({ x: 0, y: 0, zoom: 1 })

export function clampZoom (z: number) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) }

export function screenToWorld (sx: number, sy: number) {
  const c = camera.get()
  return { x: (sx - c.x) / c.zoom, y: (sy - c.y) / c.zoom }
}

export function zoomAt (sx: number, sy: number, zoom: number) {
  const c = camera.get()
  const z = clampZoom(zoom)
  const wx = (sx - c.x) / c.zoom
  const wy = (sy - c.y) / c.zoom
  camera.set({ zoom: z, x: sx - wx * z, y: sy - wy * z })
}

let anim = 0
export function animateCamera (target: Camera, ms = 320) {
  cancelAnimationFrame(anim)
  const from = camera.get()
  const t0 = performance.now()
  // Interpolate zoom logarithmically so the motion feels uniform.
  const lz0 = Math.log(from.zoom)
  const lz1 = Math.log(target.zoom)
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms)
    const e = 1 - Math.pow(1 - t, 3)
    camera.set({
      x: from.x + (target.x - from.x) * e,
      y: from.y + (target.y - from.y) * e,
      zoom: Math.exp(lz0 + (lz1 - lz0) * e)
    })
    if (t < 1) anim = requestAnimationFrame(step)
  }
  anim = requestAnimationFrame(step)
}

export function viewportSize () {
  const el = document.getElementById('viewport')
  return el ? { w: el.clientWidth, h: el.clientHeight } : { w: innerWidth, h: innerHeight }
}

export function zoomToRect (r: Rect, padding = 80, animate = true, maxZoom = 2) {
  const { w, h } = viewportSize()
  const zoom = clampZoom(Math.min((w - padding * 2) / Math.max(r.w, 1), (h - padding * 2) / Math.max(r.h, 1), maxZoom))
  const target = { zoom, x: w / 2 - (r.x + r.w / 2) * zoom, y: h / 2 - (r.y + r.h / 2) * zoom }
  if (animate) animateCamera(target)
  else camera.set(target)
}

export function zoomBy (factor: number) {
  const { w, h } = viewportSize()
  const c = camera.get()
  animateCamera({ ...c, ...zoomedAround(w / 2, h / 2, clampZoom(c.zoom * factor)) }, 180)
}

function zoomedAround (sx: number, sy: number, z: number) {
  const c = camera.get()
  const wx = (sx - c.x) / c.zoom
  const wy = (sy - c.y) / c.zoom
  return { zoom: z, x: sx - wx * z, y: sy - wy * z }
}

export function viewportCenterWorld () {
  const { w, h } = viewportSize()
  return screenToWorld(w / 2, h / 2)
}

// ---------------------------------------------------------------- UI state

export type Tool = 'select' | 'hand' | 'frame' | 'sticky' | 'text' | 'shape' | 'connector' | 'board'
export type WheelMode = 'auto' | 'zoom' | 'scroll'

export interface Guide { x1: number; y1: number; x2: number; y2: number }

export interface Connecting {
  fromId: string | null
  fromAnchor: Side | 'auto'
  from: { x: number; y: number }
  to: { x: number; y: number }
  hoverId: string | null
}

export interface UiState {
  tool: Tool
  selected: string[]
  editing: string | null
  hoverId: string | null
  guides: Guide[]
  marquee: Rect | null
  connecting: Connecting | null
  snapObjects: boolean
  snapGrid: boolean
  gridSize: number
  showGrid: boolean
  wheelMode: WheelMode
  framesPanel: boolean
  presenting: number | null
  preview: { url: string; kind: 'link' | 'video'; embed?: string } | null
  dragging: boolean
  defaultRoute: Route
  shapeKind: ShapeKind
  stickyColor: string
  /** Frame the user has entered (double click); everything else is dimmed. */
  focus: string | null
  toast: string | null
}

const saved = (() => { try { return JSON.parse(localStorage.getItem('planche:ui') || '{}') } catch { return {} } })()

export const ui = createStore<UiState>({
  tool: 'select',
  selected: [],
  editing: null,
  hoverId: null,
  guides: [],
  marquee: null,
  connecting: null,
  snapObjects: saved.snapObjects ?? true,
  snapGrid: saved.snapGrid ?? false,
  gridSize: saved.gridSize ?? 20,
  showGrid: saved.showGrid ?? true,
  wheelMode: saved.wheelMode ?? 'auto',
  framesPanel: saved.framesPanel ?? true,
  presenting: null,
  preview: null,
  dragging: false,
  defaultRoute: saved.defaultRoute ?? 'curved',
  shapeKind: saved.shapeKind ?? 'rect',
  stickyColor: saved.stickyColor ?? '#fde68a',
  focus: null,
  toast: null
})

ui.subscribe(() => {
  const s = ui.get()
  const keep = { snapObjects: s.snapObjects, snapGrid: s.snapGrid, gridSize: s.gridSize, showGrid: s.showGrid, wheelMode: s.wheelMode, framesPanel: s.framesPanel, defaultRoute: s.defaultRoute, shapeKind: s.shapeKind, stickyColor: s.stickyColor }
  try { localStorage.setItem('planche:ui', JSON.stringify(keep)) } catch { /* storage unavailable */ }
})

let toastTimer = 0
export function toast (msg: string) {
  ui.set({ toast: msg })
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => ui.set({ toast: null }), 2200)
}

export function select (ids: string[]) { ui.set({ selected: ids }) }
