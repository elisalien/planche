import type { ConnEnd, Item, Items, Point, Rect, Route, Side } from './types'

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
export const contains = (r: Rect, p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
export const containsRect = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h

export function normRect (a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function unionRects (rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function itemRect (it: Item, all: Items): Rect {
  if (it.type !== 'connector') return it
  const { a, b } = connectorEnds(it, all)
  return normRect(a, b)
}

export function itemsBounds (list: Item[], all: Items): Rect | null {
  return unionRects(list.map((it) => itemRect(it, all)))
}

// ---------------------------------------------------------------- connectors

const NORMALS: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }

export function sidePoint (r: Rect, side: Side): Point {
  switch (side) {
    case 'top': return { x: r.x + r.w / 2, y: r.y }
    case 'bottom': return { x: r.x + r.w / 2, y: r.y + r.h }
    case 'left': return { x: r.x, y: r.y + r.h / 2 }
    case 'right': return { x: r.x + r.w, y: r.y + r.h / 2 }
  }
}

/** Side of `r` that faces point `p`, weighted by the rectangle's aspect. */
export function facingSide (r: Rect, p: Point): Side {
  const c = center(r)
  const dx = (p.x - c.x) / Math.max(r.w, 1)
  const dy = (p.y - c.y) / Math.max(r.h, 1)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}

export function nearestSide (r: Rect, p: Point): Side {
  const d = { top: Math.abs(p.y - r.y), bottom: Math.abs(p.y - r.y - r.h), left: Math.abs(p.x - r.x), right: Math.abs(p.x - r.x - r.w) }
  return (Object.keys(d) as Side[]).reduce((a, b) => (d[a] <= d[b] ? a : b))
}

interface ResolvedEnd { p: Point; n: Point | null }

function resolveEnd (end: ConnEnd | undefined, other: Point, all: Items): ResolvedEnd {
  const target = end?.id ? all[end.id] : undefined
  if (!end || !target) return { p: { x: end?.x ?? 0, y: end?.y ?? 0 }, n: null }
  const side = end.anchor && end.anchor !== 'auto' ? end.anchor : facingSide(target, other)
  return { p: sidePoint(target, side), n: NORMALS[side] }
}

function endRefPoint (end: ConnEnd | undefined, all: Items): Point {
  const t = end?.id ? all[end.id] : undefined
  return t ? center(t) : { x: end?.x ?? 0, y: end?.y ?? 0 }
}

export function connectorEnds (it: Item, all: Items) {
  const ra = endRefPoint(it.from, all)
  const rb = endRefPoint(it.to, all)
  const A = resolveEnd(it.from, rb, all)
  const B = resolveEnd(it.to, ra, all)
  return { a: A.p, b: B.p, na: A.n, nb: B.n }
}

export interface ConnectorGeometry {
  d: string
  a: Point
  b: Point
  mid: Point
  angleA: number // direction pointing into start point
  angleB: number // direction pointing into end point
}

function towards (from: Point, to: Point): Point {
  const dx = to.x - from.x; const dy = to.y - from.y
  const l = Math.hypot(dx, dy) || 1
  return { x: dx / l, y: dy / l }
}

export function connectorGeometry (a: Point, b: Point, na: Point | null, nb: Point | null, route: Route): ConnectorGeometry {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const n1 = na ?? towards(a, b)
  const n2 = nb ?? towards(b, a)

  if (route === 'curved') {
    const k = Math.max(30, Math.min(dist * 0.45, 260))
    const c1 = { x: a.x + n1.x * k, y: a.y + n1.y * k }
    const c2 = { x: b.x + n2.x * k, y: b.y + n2.y * k }
    const t = 0.5; const u = 1 - t
    const mid = {
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y
    }
    return {
      d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`,
      a, b, mid,
      angleA: Math.atan2(a.y - c1.y, a.x - c1.x),
      angleB: Math.atan2(b.y - c2.y, b.x - c2.x)
    }
  }

  if (route === 'elbow') {
    const pts = elbowPoints(a, b, n1, n2)
    const d = 'M' + pts.map((p) => `${p.x},${p.y}`).join(' L')
    const last = pts[pts.length - 2]
    return {
      d, a, b,
      mid: polylineMid(pts),
      angleA: Math.atan2(a.y - pts[1].y, a.x - pts[1].x),
      angleB: Math.atan2(b.y - last.y, b.x - last.x)
    }
  }

  return {
    d: `M${a.x},${a.y} L${b.x},${b.y}`,
    a, b,
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    angleA: Math.atan2(a.y - b.y, a.x - b.x),
    angleB: Math.atan2(b.y - a.y, b.x - a.x)
  }
}

function elbowPoints (a: Point, b: Point, n1: Point, n2: Point): Point[] {
  const gap = 24
  const s = { x: a.x + n1.x * gap, y: a.y + n1.y * gap }
  const e = { x: b.x + n2.x * gap, y: b.y + n2.y * gap }
  const h1 = Math.abs(n1.x) > Math.abs(n1.y)
  const h2 = Math.abs(n2.x) > Math.abs(n2.y)
  let mids: Point[]
  if (h1 && h2) { const mx = (s.x + e.x) / 2; mids = [{ x: mx, y: s.y }, { x: mx, y: e.y }] } else if (!h1 && !h2) { const my = (s.y + e.y) / 2; mids = [{ x: s.x, y: my }, { x: e.x, y: my }] } else if (h1) mids = [{ x: e.x, y: s.y }]
  else mids = [{ x: s.x, y: e.y }]
  return [a, s, ...mids, e, b]
}

function polylineMid (pts: Point[]): Point {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  let half = total / 2
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (half <= l) { const t = l ? half / l : 0; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t } }
    half -= l
  }
  return pts[0]
}

export function arrowHead (tip: Point, angle: number, size: number) {
  const a1 = angle + Math.PI - 0.45
  const a2 = angle + Math.PI + 0.45
  return `${tip.x},${tip.y} ${tip.x + Math.cos(a1) * size},${tip.y + Math.sin(a1) * size} ${tip.x + Math.cos(a2) * size},${tip.y + Math.sin(a2) * size}`
}
