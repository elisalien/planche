import type { Rect } from './types'
import type { Guide } from './store'

/** Which lines of the moving rectangle may snap (3 per axis: start, center, end). */
export interface SnapLines { x: ('start' | 'center' | 'end')[]; y: ('start' | 'center' | 'end')[] }
export const ALL_LINES: SnapLines = { x: ['start', 'center', 'end'], y: ['start', 'center', 'end'] }

const lineOf = (r: Rect, axis: 'x' | 'y', k: 'start' | 'center' | 'end') => {
  const p = axis === 'x' ? r.x : r.y
  const s = axis === 'x' ? r.w : r.h
  return k === 'start' ? p : k === 'center' ? p + s / 2 : p + s
}

interface AxisHit { delta: number; value: number }

function bestAxis (r: Rect, others: Rect[], axis: 'x' | 'y', keys: SnapLines['x'], threshold: number): AxisHit | null {
  let best: AxisHit | null = null
  for (const k of keys) {
    const v = lineOf(r, axis, k)
    for (const o of others) {
      for (const ok of ['start', 'center', 'end'] as const) {
        const t = lineOf(o, axis, ok)
        const d = t - v
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, value: t }
      }
    }
  }
  return best
}

/**
 * Snap a rectangle to other rectangles' edges and centers (smart guides),
 * falling back to the grid. Returns the correction and guide lines to draw.
 */
export function snapRect (
  r: Rect, others: Rect[], threshold: number,
  opts: { lines?: SnapLines; objects: boolean; grid: number | null }
): { dx: number; dy: number; guides: Guide[] } {
  const lines = opts.lines ?? ALL_LINES
  let dx = 0; let dy = 0
  const hx = opts.objects && lines.x.length ? bestAxis(r, others, 'x', lines.x, threshold) : null
  const hy = opts.objects && lines.y.length ? bestAxis(r, others, 'y', lines.y, threshold) : null
  if (hx) dx = hx.delta
  else if (opts.grid && lines.x.length) dx = gridDelta(lineOf(r, 'x', lines.x[0]), opts.grid)
  if (hy) dy = hy.delta
  else if (opts.grid && lines.y.length) dy = gridDelta(lineOf(r, 'y', lines.y[0]), opts.grid)

  const snapped = { ...r, x: r.x + dx, y: r.y + dy }
  const guides: Guide[] = []
  if (hx) guides.push(...guidesFor(snapped, others, 'x', threshold / 4))
  if (hy) guides.push(...guidesFor(snapped, others, 'y', threshold / 4))
  return { dx, dy, guides }
}

function gridDelta (v: number, g: number) { return Math.round(v / g) * g - v }

function guidesFor (r: Rect, others: Rect[], axis: 'x' | 'y', eps: number): Guide[] {
  const out: Guide[] = []
  for (const k of ['start', 'center', 'end'] as const) {
    const v = lineOf(r, axis, k)
    const matched = others.filter((o) => (['start', 'center', 'end'] as const).some((ok) => Math.abs(lineOf(o, axis, ok) - v) <= eps))
    if (!matched.length) continue
    const span = [r, ...matched]
    if (axis === 'x') {
      out.push({ x1: v, x2: v, y1: Math.min(...span.map((s) => s.y)), y2: Math.max(...span.map((s) => s.y + s.h)) })
    } else {
      out.push({ y1: v, y2: v, x1: Math.min(...span.map((s) => s.x)), x2: Math.max(...span.map((s) => s.x + s.w)) })
    }
  }
  return out
}
