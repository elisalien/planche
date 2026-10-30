// Linked text styles: an item references a style and its own text properties
// act as local overrides, so redefining a style updates every item using it.

import { useMemo, useSyncExternalStore } from 'react'
import { getItems, me, newId, stylesMap, transact, updateItem } from './board'
import type { Item, TextStyle } from './types'

/** Text properties a style controls. */
export const STYLE_KEYS = [
  'fontFamily', 'fontSize', 'fontWeight', 'italic', 'underline', 'strike', 'tracking', 'textCase', 'color',
  'align', 'vAlign', 'lineHeight', 'spaceBefore', 'spaceAfter', 'indent', 'padding'
] as const satisfies readonly (keyof Item)[]

// ---------------------------------------------------------------- snapshots

let snapshot: Record<string, TextStyle> = {}
const listeners = new Set<() => void>()
stylesMap.observe(() => {
  const next: Record<string, TextStyle> = {}
  stylesMap.forEach((v, k) => { next[k] = v })
  snapshot = next
  listeners.forEach((l) => l())
})
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function getStyles () { return snapshot }
export function subscribeStyles (l: () => void) { return subscribe(l) }
export function useStyles () { return useSyncExternalStore(subscribe, () => snapshot) }
export function useStyle (id: string | null | undefined) {
  return useSyncExternalStore(subscribe, () => (id ? snapshot[id] : undefined))
}

/** Styles this user can see: shared ones, then their personal ones. */
export function visibleStyles (all = snapshot) {
  const list = Object.values(all).filter((s) => !s.owner || s.owner === me.id)
  return list.sort((a, b) => Number(!!a.owner) - Number(!!b.owner) || a.order - b.order || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------- resolution

export function resolveWith (it: Item, st: TextStyle | undefined): Item {
  if (!st) return it
  const out: Item = { ...it }
  const rec = out as unknown as Record<string, unknown>
  for (const k of STYLE_KEYS) if (rec[k] === undefined && st.props[k] !== undefined) rec[k] = st.props[k]
  return out
}

export function resolve (it: Item): Item {
  return resolveWith(it, it.styleId ? snapshot[it.styleId] : undefined)
}

/** Item with its linked style applied; re-renders when the style changes. */
export function useResolved (it: Item): Item {
  const st = useStyle(it.styleId)
  return useMemo(() => resolveWith(it, st), [it, st])
}

/** True when the item is linked to a style and overrides some of it locally. */
export function hasOverrides (it: Item) {
  return !!it.styleId && STYLE_KEYS.some((k) => it[k] !== undefined)
}

function styleProps (it: Item): Partial<Item> {
  const out: Record<string, unknown> = {}
  for (const k of STYLE_KEYS) if (it[k] !== undefined) out[k] = it[k]
  return out as Partial<Item>
}

const CLEARED = Object.fromEntries(STYLE_KEYS.map((k) => [k, undefined])) as Partial<Item>

// ---------------------------------------------------------------- mutations

/** New style from the (resolved) look of an item, linked to the given items. */
export function createStyle (name: string, from: Item, personal: boolean, linkIds: string[]) {
  const order = Object.values(snapshot).reduce((m, s) => Math.max(m, s.order), 0) + 1
  const st: TextStyle = { id: newId(), name, props: styleProps(resolve(from)), owner: personal ? me.id : null, order }
  transact(() => {
    stylesMap.set(st.id, st)
    for (const id of linkIds) updateItem(id, { ...CLEARED, styleId: st.id })
  })
  return st
}

/** Link items to a style (dropping their overrides), or unlink them keeping their look. */
export function applyStyle (ids: string[], styleId: string | null) {
  const all = getItems()
  transact(() => {
    for (const id of ids) {
      const it = all[id]
      if (!it) continue
      if (styleId) updateItem(id, { ...CLEARED, styleId })
      else updateItem(id, { ...styleProps(resolve(it)), styleId: null })
    }
  })
}

export function clearOverrides (ids: string[]) {
  transact(() => { for (const id of ids) if (getItems()[id]?.styleId) updateItem(id, CLEARED) })
}

/** Redefine a style from an item's current look; its overrides become the style. */
export function redefineStyle (styleId: string, from: Item) {
  const st = snapshot[styleId]
  if (!st) return
  transact(() => {
    stylesMap.set(styleId, { ...st, props: styleProps(resolveWith(from, st)) })
    if (from.styleId === styleId) updateItem(from.id, CLEARED)
  })
}

export function updateStyle (styleId: string, patch: Partial<TextStyle>) {
  const st = snapshot[styleId]
  if (st) transact(() => stylesMap.set(styleId, { ...st, ...patch }))
}

export function duplicateStyle (styleId: string) {
  const st = snapshot[styleId]
  if (!st) return
  const order = Object.values(snapshot).reduce((m, s) => Math.max(m, s.order), 0) + 1
  const id = newId()
  transact(() => stylesMap.set(id, { ...st, id, name: `${st.name} copie`, order }))
}

/** Delete a style; items using it keep their current look as local properties. */
export function deleteStyle (styleId: string) {
  const st = snapshot[styleId]
  if (!st) return
  transact(() => {
    for (const it of Object.values(getItems())) {
      if (it.styleId === styleId) updateItem(it.id, { ...styleProps(resolveWith(it, st)), styleId: null })
    }
    stylesMap.delete(styleId)
  })
}
