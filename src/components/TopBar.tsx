import { useRef, useState } from 'react'
import { Download, FilePlus2, FolderOpen, Menu, Moon, PanelLeft, Presentation, Settings, Share2, Sun, Upload } from 'lucide-react'
import { boardId, exportBoard, frames, importBoard, me, net, newId, recentBoards, setMe, setMeta, useMeta, usePeers } from '../board'
import { toast, ui, useStore, type WheelMode } from '../store'

export function TopBar () {
  const m = useMeta()
  const peers = usePeers()
  const status = useStore(net, (n) => n.status)
  const [menu, setMenu] = useState<null | 'main' | 'settings'>(null)
  const [name, setName] = useState(me.name)
  const fileRef = useRef<HTMLInputElement>(null)
  const wheelMode = useStore(ui, (s) => s.wheelMode)
  const dark = m.ui === 'dark'

  const share = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Lien du tableau copié') } catch { prompt('Lien du tableau :', location.href) }
  }
  const download = () => {
    const blob = new Blob([exportBoard()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${m.name.replace(/[^\w-]+/g, '_') || 'tableau'}.planche.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const statusLabel = { local: 'Local (hors ligne)', connecting: 'Connexion…', connected: 'En ligne', offline: 'Déconnecté' }[status]

  return (
    <>
      <div className='topbar left panel'>
        <button className='tool' title='Menu' onClick={() => setMenu(menu === 'main' ? null : 'main')}><Menu size={18} /></button>
        <input className='board-name' value={m.name} onChange={(e) => setMeta('name', e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        <button className='tool' title='Cadres' onClick={() => ui.set({ framesPanel: !ui.get().framesPanel })}><PanelLeft size={18} /></button>
      </div>

      <div className='topbar right panel'>
        <span className={`status ${status}`} title={statusLabel}><i />{statusLabel}</span>
        <div className='avatars'>
          <span className='avatar me' style={{ background: me.color }} title={`${me.name} (vous)`}>{me.name.slice(0, 1).toUpperCase()}</span>
          {peers.slice(0, 6).map((p) => <span key={p.clientId} className='avatar' style={{ background: p.user.color }} title={p.user.name}>{p.user.name.slice(0, 1).toUpperCase()}</span>)}
          {peers.length > 6 && <span className='avatar more'>+{peers.length - 6}</span>}
        </div>
        <button className='btn' onClick={() => { if (frames().length) ui.set({ presenting: 0, selected: [] }); else toast('Ajoutez des cadres pour présenter') }} title='Présenter les cadres (P)'><Presentation size={16} /> Présenter</button>
        <button className='btn primary' onClick={share}><Share2 size={16} /> Partager</button>
        <button className='tool' title={dark ? 'Mode clair (interface + canevas)' : 'Mode sombre (interface + canevas)'} onClick={() => {
          setMeta('ui', dark ? 'light' : 'dark')
          setMeta('canvas', dark ? 'light' : 'dark')
        }}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <button className='tool' title='Paramètres' onClick={() => setMenu(menu === 'settings' ? null : 'settings')}><Settings size={18} /></button>
      </div>

      {menu === 'main' && (
        <div className='menu panel' style={{ left: 12, top: 60 }} onPointerLeave={() => setMenu(null)}>
          <button onClick={() => { location.hash = `#/b/${newId(12)}` }}><FilePlus2 size={16} /> Nouveau tableau</button>
          <button onClick={download}><Download size={16} /> Exporter (.json)</button>
          <button onClick={() => fileRef.current?.click()}><Upload size={16} /> Importer (.json)</button>
          <div className='menu-title'><FolderOpen size={14} /> Tableaux récents</div>
          <div className='recent' data-scroll>
            {recentBoards().map((b) => (
              <a key={b.id} href={`#/b/${b.id}`} className={b.id === boardId ? 'current' : ''}>
                <span>{b.name}</span><small>{new Date(b.updated).toLocaleDateString()}</small>
              </a>
            ))}
          </div>
        </div>
      )}

      {menu === 'settings' && (
        <div className='menu panel settings' style={{ right: 12, top: 60 }}>
          <label>Votre nom
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setMe({ name: name.trim() || me.name })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label>Couleur
            <input type='color' defaultValue={me.color} onChange={(e) => setMe({ color: e.target.value })} />
          </label>
          <div className='settings-group'>
            <span>Apparence de ce tableau (pour tous)</span>
            <div className='row'>Interface
              <div className='seg'>
                <button className={m.ui === 'light' ? 'active' : ''} onClick={() => setMeta('ui', 'light')}><Sun size={14} /> Clair</button>
                <button className={m.ui === 'dark' ? 'active' : ''} onClick={() => setMeta('ui', 'dark')}><Moon size={14} /> Sombre</button>
              </div>
            </div>
            <div className='row'>Canevas
              <div className='seg'>
                <button className={m.canvas === 'light' ? 'active' : ''} onClick={() => setMeta('canvas', 'light')}>Clair</button>
                <button className={m.canvas === 'dark' ? 'active' : ''} onClick={() => setMeta('canvas', 'dark')}>Noir</button>
                <button className={m.canvas === 'custom' ? 'active' : ''} onClick={() => setMeta('canvas', 'custom')}>Couleur</button>
              </div>
            </div>
            {m.canvas === 'custom' && (
              <div className='row'>Couleur du canevas
                <input type='color' value={m.bg} onChange={(e) => setMeta('bg', e.target.value)} />
              </div>
            )}
          </div>
          <label>Molette de la souris
            <select value={wheelMode} onChange={(e) => ui.set({ wheelMode: e.target.value as WheelMode })}>
              <option value='auto'>Auto (souris = zoom, trackpad = défilement)</option>
              <option value='zoom'>Toujours zoomer</option>
              <option value='scroll'>Toujours défiler (Ctrl = zoom)</option>
            </select>
          </label>
          <label>Serveur de collaboration
            <input placeholder='(même origine)' defaultValue={localStorage.getItem('planche:server') ?? ''} onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) => { const v = e.target.value.trim(); if (v) localStorage.setItem('planche:server', v); else localStorage.removeItem('planche:server') }} />
            <small>Ex. wss://mon-serveur.onrender.com/yjs — rechargez la page après modification.</small>
          </label>
          <button className='btn' onClick={() => setMenu(null)}>Fermer</button>
        </div>
      )}

      <input ref={fileRef} type='file' accept='.json,application/json' hidden onChange={async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        try {
          const replace = confirm('Remplacer le contenu du tableau actuel ?\nOK = remplacer, Annuler = ajouter au tableau.')
          importBoard(await f.text(), replace)
          toast('Import terminé')
        } catch (err) { toast(`Import impossible : ${(err as Error).message}`) }
        setMenu(null)
      }} />
    </>
  )
}
