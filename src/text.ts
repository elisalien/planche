import type { CSSProperties } from 'react'
import type { Item, TextAlign, VAlign } from './types'

/** Item types whose text is edited and styled through the shared text engine. */
export const TEXT_TYPES = new Set(['sticky', 'shape', 'text'])

/** Per-type defaults; unset item properties fall back to these. */
export function textDefaults (it: Item): { align: TextAlign; vAlign: VAlign; padding: number } {
  switch (it.type) {
    case 'text': return { align: 'left', vAlign: 'top', padding: 4 }
    case 'sticky': return { align: 'center', vAlign: 'middle', padding: 12 }
    default: return { align: 'center', vAlign: 'middle', padding: 10 }
  }
}

const JUSTIFY: Record<VAlign, string> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }

/** Character and paragraph styles for the text element itself. */
export function textCss (it: Item, fallbackColor?: string): CSSProperties {
  const d = textDefaults(it)
  const deco = [it.underline && 'underline', it.strike && 'line-through'].filter(Boolean).join(' ')
  // Unset keys are dropped so callers can spread this over their own defaults.
  return compact({
    fontFamily: it.fontFamily,
    fontSize: it.fontSize,
    fontWeight: it.fontWeight,
    fontStyle: it.italic ? 'italic' : undefined,
    textDecoration: deco || undefined,
    letterSpacing: it.tracking ? `${it.tracking / 1000}em` : undefined,
    textTransform: it.textCase && it.textCase !== 'none' ? it.textCase : undefined,
    color: it.color ?? fallbackColor,
    textAlign: it.align ?? d.align,
    lineHeight: it.lineHeight,
    ['--sb' as string]: it.spaceBefore ? `${it.spaceBefore}px` : undefined,
    ['--sa' as string]: it.spaceAfter ? `${it.spaceAfter}px` : undefined,
    ['--ti' as string]: it.indent ? `${it.indent}px` : undefined
  })
}

function compact (o: Record<string, unknown>): CSSProperties {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as CSSProperties
}

/** Layout of the box that holds the text (vertical alignment, inner margin). */
export function textBoxCss (it: Item): CSSProperties {
  const d = textDefaults(it)
  return { justifyContent: JUSTIFY[it.vAlign ?? d.vAlign], padding: it.padding ?? d.padding }
}
