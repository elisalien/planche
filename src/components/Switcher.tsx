import { useEffect, useMemo, useRef, useState } from 'react'
import { Frame as FrameIcon, LayoutGrid, Search, Star } from 'lucide-react'
import { boardId, frameTree, toggleFavorite, useBoardIndex, useItems } from '../board'
import { select, ui, useStore, zoomToRect } from '../store'
import { enterFocus } from '../actions'

interface Row {
  key: string
  group: string
  label: string
  hint?: string
  icon: 'board' | 'frame'
  fav?: boolean
  boardId?: string
  run: () => void
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Ctrl+K: jump to any known board, sub-board or frame. */
export function Switcher () {
  const open = useStore(ui, (s) => s.switcher)
  const index = useBoardIndex()
  const items = useItems()
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) { setQ(''); setCursor(0) } }, [open])

  const rows = useMemo(() => {
    if (!open) return [] as Row[]
    const close = () => ui.set({ switcher: false })
    const go = (id: string) => { close(); location.hash = `#/b/${id}` }
    const nameOf = (id: string | null | undefined) => (id ? index.find((b) => b.id === id)?.name : undefined)
    const out: Row[] = []
    for (const n of frameTree()) {
      const f = n.frame
      out.push({
        key: `f-${f.id}`, group: 'Cadres de ce board', icon: 'frame', label: `${'  '.repeat(n.depth)}${f.title || 'Sans titre'}`,
        run: () => { close(); select([f.id]); if (n.depth > 0) enterFocus(f.id); else zoomToRect(f, 60, true, 4) }
      })
    }
    for (const c of Object.values(items)) {
      if (c.type === 'board' && c.boardRef) out.push({ key: `c-${c.id}`, group: 'Sous-boards de ce board', icon: 'board', label: c.title || 'Sans titre', boardId: c.boardRef, run: () => go(c.boardRef!) })
    }
    const boards = index.filter((b) => b.id !== boardId)
    const favs = boards.filter((b) => b.fav)
    const recents = boards.filter((b) => !b.fav && b.updated > 0).sort((a, b) => b.updated - a.updated)
    const known = boards.filter((b) => !b.fav && !b.updated)
    for (const [group, list] of [['Favoris', favs], ['Récents', recents], ['Autres boards connus', known]] as const) {
      for (const b of list) {
        const parent = nameOf(b.parent)
        out.push({ key: `b-${b.id}`, group, icon: 'board', label: b.name, hint: parent ? `dans ${parent}` : undefined, fav: b.fav, boardId: b.id, run: () => go(b.id) })
      }
    }
    const words = norm(q).split(/\s+/).filter(Boolean)
    return words.length ? out.filter((r) => words.every((w) => norm(`${r.label} ${r.hint ?? ''}`).includes(w))) : out
  }, [open, index, items, q])

  useEffect(() => { setCursor((c) => Math.min(c, Math.max(rows.length - 1, 0))) }, [rows.length])
  useEffect(() => { listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }) }, [cursor])

  if (!open) return null
  const close = () => ui.set({ switcher: false })

  return (
    <div className='modal-backdrop switcher-backdrop' onClick={close}>
      <div className='switcher panel' onClick={(e) => e.stopPropagation()}>
        <div className='switcher-input'>
          <Search size={16} />
          <input autoFocus placeholder='Aller à un board, un sous-board ou un cadre…' value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0) }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
              else if (e.key === 'Enter') rows[cursor]?.run()
            }} />
          <kbd>Échap</kbd>
        </div>
        <div className='switcher-list' ref={listRef} data-scroll>
          {!rows.length && <div className='crumb-empty'>Aucun résultat</div>}
          {rows.map((r, i) => (
            <div key={r.key}>
              {(i === 0 || rows[i - 1].group !== r.group) && <div className='crumb-group'>{r.group}</div>}
              <div className={`switcher-row${i === cursor ? ' active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={r.run}>
                {r.icon === 'board' ? <LayoutGrid size={15} /> : <FrameIcon size={15} />}
                <span className='label'>{r.label}</span>
                {r.hint && <small>{r.hint}</small>}
                {r.boardId && (
                  <button className={`crumb-fav${r.fav ? ' on' : ''}`} title={r.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(r.boardId!) }}>
                    <Star size={13} fill={r.fav ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
