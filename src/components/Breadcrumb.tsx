import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Frame as FrameIcon, LayoutGrid, Star, X } from 'lucide-react'
import {
  ancestorsOf, boardId, frameTree, setMeta, toggleFavorite, useBoardIndex, useItems, useMeta, type BoardEntry
} from '../board'
import { ui, useStore, zoomToRect } from '../store'
import { enterFocus } from '../actions'
import type { Item } from '../types'

interface MenuEntry { key: string; label: string; icon: 'board' | 'frame'; current?: boolean; onPick: () => void }

function Crumb ({ label, onClick, menu, title, current }: {
  label: string; onClick?: () => void; menu?: () => { title: string; entries: MenuEntry[] }[]; title?: string; current?: boolean
}) {
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  const groups = open && menu ? menu().filter((g) => g.entries.length) : []
  return (
    <span className='crumb-wrap' ref={ref}>
      <button className={`crumb${current ? ' current' : ''}`} onClick={onClick} title={title ?? label}>{label}</button>
      {menu && (
        <button className='crumb-more' title='Changer de niveau' onClick={(e) => {
          // Fixed position: the breadcrumb clips its overflow.
          const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
          setOpen(open ? null : { left: r.left, top: r.bottom + 6 })
        }}><ChevronDown size={13} /></button>
      )}
      {open && (
        <div className='crumb-menu panel' data-scroll style={{ left: open.left, top: open.top }}>
          {!groups.length && <div className='crumb-empty'>Rien d’autre à ce niveau</div>}
          {groups.map((g) => (
            <div key={g.title}>
              <div className='crumb-group'>{g.title}</div>
              {g.entries.map((e) => (
                <button key={e.key} className={e.current ? 'active' : ''} onClick={() => { setOpen(null); e.onPick() }}>
                  {e.icon === 'board' ? <LayoutGrid size={14} /> : <FrameIcon size={14} />}<span>{e.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

const go = (id: string) => { location.hash = `#/b/${id}` }

function boardEntries (list: BoardEntry[], parent: string | null, currentId: string): MenuEntry[] {
  return list
    .filter((b) => (b.parent ?? null) === parent && (parent !== null || b.updated > 0))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => ({ key: b.id, label: b.name, icon: 'board' as const, current: b.id === currentId, onPick: () => go(b.id) }))
}

function frameEntries (siblings: Item[], currentId: string): MenuEntry[] {
  return siblings.map((f) => ({ key: f.id, label: f.title || 'Sans titre', icon: 'frame' as const, current: f.id === currentId, onPick: () => enterFocus(f.id) }))
}

/**
 * Board hierarchy, then the entered frames: Projet › Sous-board › Cadre › Cadre imbriqué.
 * Each level opens its siblings.
 */
export function Breadcrumb () {
  const m = useMeta()
  const index = useBoardIndex()
  const items = useItems()
  const focus = useStore(ui, (s) => s.focus)
  const nameOf = (id: string, fallback: string) => index.find((b) => b.id === id)?.name ?? fallback
  const fav = !!index.find((b) => b.id === boardId)?.fav

  const focusFrame = focus ? items[focus] : null
  const framePath = focusFrame ? [...ancestorsOf(focusFrame.id)].reverse().concat(focusFrame) : []
  const tree = frameTree()
  const siblingFrames = (f: Item) => tree.filter((n) => (n.frame.parentId ?? null) === (f.parentId ?? null)).map((n) => n.frame)
  const subBoards = Object.values(items).filter((i) => i.type === 'board' && i.boardRef)

  return (
    <div className='breadcrumb'>
      {m.ancestors.map((a, i) => (
        <span key={a.id} className='crumb-step'>
          <Crumb label={nameOf(a.id, a.name)} title='Ouvrir ce board' onClick={() => go(a.id)}
            menu={() => [{ title: 'Au même niveau', entries: boardEntries(index, m.ancestors[i - 1]?.id ?? null, a.id) }]} />
          <span className='sep'>›</span>
        </span>
      ))}
      <span className='crumb-step'>
        <input className='board-name' value={m.name} title='Nom du board'
          onChange={(e) => setMeta('name', e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          style={{ width: `${Math.min(Math.max(m.name.length, 6), 28) + 2}ch` }} />
        <Crumb label='' menu={() => [
          { title: 'Au même niveau', entries: boardEntries(index, m.parent?.id ?? null, boardId) },
          { title: 'Sous-boards de ce board', entries: subBoards.map((c) => ({ key: c.id, label: c.title || 'Sans titre', icon: 'board' as const, onPick: () => go(c.boardRef!) })) },
          { title: 'Cadres', entries: tree.filter((n) => n.depth === 0).map((n) => ({ key: n.frame.id, label: n.frame.title || 'Sans titre', icon: 'frame' as const, onPick: () => enterFocus(n.frame.id) })) }
        ]} />
        <button className={`crumb-fav${fav ? ' on' : ''}`} title={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'} onClick={() => toggleFavorite(boardId)}>
          <Star size={14} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </span>
      {framePath.map((f) => (
        <span key={f.id} className='crumb-step'>
          <span className='sep'>›</span>
          <Crumb label={f.title || 'Sans titre'} current={f.id === focus} onClick={() => enterFocus(f.id)}
            menu={() => [{ title: 'Cadres au même niveau', entries: frameEntries(siblingFrames(f), f.id) }]} />
        </span>
      ))}
      {focusFrame && (
        <button className='crumb-exit' title='Sortir des cadres (Échap pour remonter d’un niveau)'
          onClick={() => { ui.set({ focus: null }); zoomToRect(focusFrame, 160, true, 1) }}><X size={14} /></button>
      )}
    </div>
  )
}
