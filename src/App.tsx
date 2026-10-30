import { useEffect, useState } from 'react'
import { awareness, canvasIsDark, getItems, net, subscribeItems, useMeta } from './board'
import { ensureFont } from './fonts'
import { camera, ui, useStore, viewportCenterWorld, viewportSize, zoomBy } from './store'
import {
  copySelection, deleteSelection, duplicateSelection, fitAll, frameSelection, nudge, pasteClip, redo, reorder, selectAll,
  undo, zoomToSelection
} from './actions'
import { align } from './align'
import { createImageItem, createTextItem, createUrlItem, URL_RE } from './media'
import { Canvas, isTyping, pointer } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { TopBar } from './components/TopBar'
import { Inspector } from './components/Inspector'
import { FramesPanel, PreviewModal, Presenter, Toast, ZoomBar } from './components/Panels'
import type { Tool } from './store'

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', f: 'frame', n: 'sticky', t: 'text', r: 'shape', o: 'shape', l: 'connector', c: 'connector' }

function onKeyDown (e: KeyboardEvent) {
  if (isTyping(e.target)) return
  const s = ui.get()
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()

  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
  if (mod && k === 'y') { e.preventDefault(); redo(); return }
  if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return }
  if (mod && k === 'a') { e.preventDefault(); selectAll(); return }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomBy(1.25); return }
  if (mod && k === '-') { e.preventDefault(); zoomBy(1 / 1.25); return }
  if (mod && k === '0') {
    e.preventDefault()
    const { w, h } = viewportSize(); const c = viewportCenterWorld()
    camera.set({ zoom: 1, x: w / 2 - c.x, y: h / 2 - c.y })
    return
  }
  if (mod) return

  if (e.altKey && s.selected.length) {
    const op = ({ a: 'left', d: 'right', h: 'hcenter', w: 'top', s: 'bottom', v: 'vcenter' } as const)[k as 'a']
    if (op) { e.preventDefault(); align(s.selected, op); return }
  }

  if (e.shiftKey && e.key === '!') { fitAll(); return }
  if (e.shiftKey && (e.code === 'Digit1')) { fitAll(); return }
  if (e.shiftKey && (e.code === 'Digit2')) { zoomToSelection(); return }
  if (e.shiftKey && k === 'f') { frameSelection(); return }

  switch (e.key) {
    case 'Delete': case 'Backspace': deleteSelection(); return
    case 'Escape': ui.set({ selected: [], tool: 'select', connecting: null, editing: null }); return
    case 'Enter': {
      const id = s.selected[0]
      const it = id ? getItems()[id] : null
      if (it && s.selected.length === 1 && ['sticky', 'text', 'shape', 'frame', 'connector'].includes(it.type)) { e.preventDefault(); ui.set({ editing: id }) }
      return
    }
    case ']': reorder(true); return
    case '[': reorder(false); return
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      if (!s.selected.length) return
      e.preventDefault()
      const d = e.shiftKey ? 10 : 1
      nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0)
      return
    }
  }
  if (k === 'p' && !e.altKey) { ui.set({ presenting: 0, selected: [] }); return }
  if (k === '?') { ui.set({ toast: null }); window.dispatchEvent(new Event('planche:help')); return }
  const tool = TOOL_KEYS[k]
  if (tool && !e.altKey) {
    if (k === 'o') ui.set({ shapeKind: 'ellipse' })
    if (k === 'r') ui.set({ shapeKind: 'rect' })
    ui.set({ tool, connecting: null })
  }
}

function onPaste (e: ClipboardEvent) {
  if (isTyping(e.target) || !e.clipboardData) return
  const at = pointer.world ?? viewportCenterWorld()
  const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
  if (file) { e.preventDefault(); createImageItem(file, at); return }
  const text = e.clipboardData.getData('text/plain').trim()
  if (!text) return
  e.preventDefault()
  if (pasteClip(text, at)) return
  if (URL_RE.test(text)) createUrlItem(text, at)
  else if (/^www\.\S+$/.test(text)) createUrlItem(`https://${text}`, at)
  else createTextItem(text, at)
}

function onCopy (e: ClipboardEvent) {
  if (isTyping(e.target) || getSelection()?.toString()) return
  copySelection(e)
}

function onCut (e: ClipboardEvent) {
  if (isTyping(e.target)) return
  if (copySelection(e)) deleteSelection()
}

function Help () {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const h = () => setOpen((o) => !o)
    window.addEventListener('planche:help', h)
    return () => window.removeEventListener('planche:help', h)
  }, [])
  if (!open) return <button className='help-btn panel' onClick={() => setOpen(true)} title='Raccourcis (?)'>?</button>
  const rows: [string, string][] = [
    ['V / H', 'Sélection / main (ou maintenir Espace)'],
    ['F', 'Cadre (glisser pour dessiner, ou formats prédéfinis)'],
    ['N / T / R / O', 'Post-it / texte / rectangle / ellipse'],
    ['L', 'Connecteur — ou glisser depuis les points bleus au survol'],
    ['Molette / Ctrl+molette', 'Zoom centré sur le curseur (pincer sur trackpad)'],
    ['Maj+1 / Maj+2', 'Tout afficher / zoomer sur la sélection'],
    ['Triple-clic', 'Écrire dans une forme ou un post-it (Entrée aussi)'],
    ['Double-clic', 'Éditer un texte libre ou un libellé, renommer / zoomer un cadre, lire une vidéo'],
    ['Alt (pendant le glisser)', 'Désactiver le magnétisme'],
    ['Alt+A/H/D, Alt+W/V/S', 'Aligner gauche/centre/droite, haut/milieu/bas'],
    ['Maj+F', 'Encadrer la sélection dans un nouveau cadre'],
    ['Ctrl+D / Ctrl+C / Ctrl+V', 'Dupliquer / copier / coller (URL → aperçu, image → image)'],
    ['[ / ]', 'Arrière-plan / premier plan'],
    ['P', 'Présenter les cadres (flèches pour naviguer)']
  ]
  return (
    <div className='modal-backdrop' onClick={() => setOpen(false)}>
      <div className='modal help' onClick={(e) => e.stopPropagation()}>
        <h3>Raccourcis</h3>
        <table><tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
      </div>
    </div>
  )
}

export function App () {
  const presenting = useStore(ui, (s) => s.presenting) !== null
  const framesPanel = useStore(ui, (s) => s.framesPanel)
  const loaded = useStore(net, (n) => n.loaded)
  const m = useMeta()
  const themeStyle = (m.canvas === 'custom' ? { '--canvas-bg': m.bg } : {}) as React.CSSProperties

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('paste', onPaste)
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCut)
    const prevent = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      const vp = document.getElementById('viewport')!.getBoundingClientRect()
      const c = camera.get()
      const at = { x: (e.clientX - vp.left - c.x) / c.zoom, y: (e.clientY - vp.top - c.y) / c.zoom }
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) { files.forEach((f, i) => createImageItem(f, { x: at.x + i * 40, y: at.y + i * 40 })); return }
      const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain')
      if (url && URL_RE.test(url.trim())) createUrlItem(url.trim(), at)
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', drop)
    // Share selection with collaborators.
    let last: string[] = []
    const unsub = ui.subscribe(() => {
      const sel = ui.get().selected
      if (sel !== last) { last = sel; awareness.setLocalStateField('selection', sel) }
    })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCut)
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', drop)
      unsub()
    }
  }, [])

  // Load the web fonts used on the board (also when collaborators apply new ones).
  useEffect(() => {
    const load = () => { for (const it of Object.values(getItems())) ensureFont(it.fontFamily) }
    load()
    return subscribeItems(load)
  }, [])

  // Initial view: fit existing content, or center the origin.
  useEffect(() => {
    if (!loaded) return
    if (Object.keys(getItems()).length) fitAll()
    else { const { w, h } = viewportSize(); camera.set({ x: w / 2, y: h / 2, zoom: 1 }) }
  }, [loaded])

  return (
    <div className={`app${presenting ? ' presenting' : ''}`} data-ui={m.ui} data-canvas={canvasIsDark(m) ? 'dark' : 'light'} style={themeStyle}>
      <Canvas />
      {!presenting && (
        <>
          <TopBar />
          <Toolbar />
          {framesPanel && <FramesPanel />}
          <Inspector />
          <ZoomBar />
          <Help />
        </>
      )}
      <Presenter />
      <PreviewModal />
      <Toast />
    </div>
  )
}
