import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical,
  AlignVerticalDistributeCenter, BringToFront, Copy, Frame as FrameIcon, Grid2x2, Lock, LockOpen, Maximize, SendToBack,
  Shrink, Trash2
} from 'lucide-react'
import { getItems, transact, updateItem, useItems } from '../board'
import { ui, useStore, zoomToRect } from '../store'
import {
  FILL_COLORS, FRAME_PRESETS, INK_COLORS, STICKY_COLORS, deleteSelection, duplicateSelection, fitFrameToContent,
  frameSelection, reorder, toggleLock
} from '../actions'
import { align, distribute, matchSize, tidy } from '../align'
import { detectVideo, unfurlInto } from '../media'
import { Seg, Swatches, patchAll } from './controls'
import { TypographyPanel } from './Typography'
import type { FramePattern, Item, Route, ShapeKind } from '../types'

const TYPE_LABEL: Record<string, string> = {
  frame: 'Cadre', sticky: 'Post-it', text: 'Texte', shape: 'Forme', link: 'Lien', video: 'Vidéo', image: 'Image', connector: 'Connecteur'
}

function Num ({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <label className='num'>
      <span>{label}</span>
      <input type='number' value={Math.round(value)} onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) onChange(v) }} />
    </label>
  )
}

function FrameSection ({ f }: { f: Item }) {
  return (
    <section>
      <h4>Cadre</h4>
      <input className='wide' value={f.title ?? ''} placeholder='Titre du cadre' onKeyDown={(e) => e.stopPropagation()} onChange={(e) => updateItem(f.id, { title: e.target.value })} />
      <label className='row'>Format
        <select value={f.preset ?? ''} onChange={(e) => {
          const p = FRAME_PRESETS.find((x) => x.id === e.target.value)
          if (p) transact(() => updateItem(f.id, { w: p.w, h: p.h, preset: p.id }))
        }}>
          <option value=''>Personnalisé</option>
          {FRAME_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.w}×{p.h}</option>)}
        </select>
      </label>
      <div className='row'>
        <Num label='L' value={f.w} onChange={(w) => updateItem(f.id, { w, preset: undefined })} />
        <Num label='H' value={f.h} onChange={(h) => updateItem(f.id, { h, preset: undefined })} />
        <button className='icon' title='Inverser orientation' onClick={() => updateItem(f.id, { w: f.h, h: f.w })}>⟲</button>
      </div>
      <div className='label'>Fond</div>
      <Swatches colors={FILL_COLORS} value={f.fill} onPick={(c) => updateItem(f.id, { fill: c })} />
      <div className='label'>Motif</div>
      <Seg<FramePattern> value={f.pattern ?? 'none'} onChange={(pattern) => updateItem(f.id, { pattern })}
        options={[{ v: 'none', label: 'Aucun' }, { v: 'dots', label: 'Points' }, { v: 'grid', label: 'Grille' }, { v: 'lines', label: 'Lignes' }]} />
      <label className='row'>Coins
        <input type='range' min={0} max={64} value={f.radius ?? 0} onChange={(e) => updateItem(f.id, { radius: Number(e.target.value) })} />
      </label>
      <label className='check'><input type='checkbox' checked={!!f.hideTitle} onChange={(e) => updateItem(f.id, { hideTitle: e.target.checked })} /> Masquer le titre</label>
      <div className='row'>
        <button className='btn' onClick={() => zoomToRect(f, 40, true, 4)}><Maximize size={14} /> Zoomer</button>
        <button className='btn' onClick={() => fitFrameToContent(f.id)}><Shrink size={14} /> Ajuster au contenu</button>
      </div>
    </section>
  )
}

function ConnectorSection ({ list }: { list: Item[] }) {
  const c = list[0]
  return (
    <section>
      <h4>Connecteur</h4>
      <Seg<Route> value={c.route ?? 'curved'} onChange={(route) => { patchAll(list, { route }); ui.set({ defaultRoute: route }) }}
        options={[{ v: 'straight', label: 'Droit' }, { v: 'curved', label: 'Courbe' }, { v: 'elbow', label: 'Coudé' }]} />
      <div className='row'>
        <label className='check'><input type='checkbox' checked={!!c.startArrow} onChange={(e) => patchAll(list, { startArrow: e.target.checked })} /> Flèche début</label>
        <label className='check'><input type='checkbox' checked={c.endArrow !== false} onChange={(e) => patchAll(list, { endArrow: e.target.checked })} /> Flèche fin</label>
      </div>
      <div className='row'>
        <label className='check'><input type='checkbox' checked={!!c.dash} onChange={(e) => patchAll(list, { dash: e.target.checked })} /> Pointillés</label>
        <label className='row'>Épaisseur <input type='range' min={1} max={10} value={c.width ?? 2} onChange={(e) => patchAll(list, { width: Number(e.target.value) })} /></label>
      </div>
      <input className='wide' placeholder='Libellé (double-clic sur le lien)' value={c.label ?? ''} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => patchAll(list, { label: e.target.value })} />
      <div className='label'>Couleur</div>
      <Swatches colors={INK_COLORS} value={c.color} onPick={(color) => patchAll(list, { color })} />
    </section>
  )
}

function LinkSection ({ it }: { it: Item }) {
  const video = detectVideo(it.url ?? '')
  return (
    <section>
      <h4>{it.type === 'video' ? 'Vidéo' : 'Lien'}</h4>
      <input className='wide' defaultValue={it.url} key={it.url} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        onBlur={(e) => {
          const url = e.target.value.trim()
          if (!url || url === it.url) return
          const v = detectVideo(url)
          updateItem(it.id, { url, video: v, type: v ? 'video' : 'link', meta: null })
          unfurlInto(it.id)
        }} />
      <div className='row'>
        <button className='btn' onClick={() => ui.set({ preview: { url: it.url!, kind: it.type === 'video' ? 'video' : 'link', embed: it.video?.embed } })}>Aperçu</button>
        <button className='btn' onClick={() => unfurlInto(it.id)}>Actualiser</button>
        <a className='btn' href={it.url} target='_blank' rel='noreferrer noopener'>Ouvrir</a>
      </div>
      {it.type === 'link' && video && (
        <button className='btn wide' onClick={() => updateItem(it.id, { type: 'video', video, w: 480, h: 334 })}>Afficher comme lecteur vidéo</button>
      )}
      {it.type === 'video' && (
        <button className='btn wide' onClick={() => updateItem(it.id, { type: 'link', w: 340, h: 300 })}>Afficher comme carte de lien</button>
      )}
    </section>
  )
}

function AlignSection ({ ids, inFrame }: { ids: string[]; inFrame: boolean }) {
  return (
    <section>
      <h4>Alignement{inFrame ? ' (dans le cadre)' : ''}</h4>
      <div className='icon-row'>
        <button title='Gauche' onClick={() => align(ids, 'left')}><AlignStartVertical size={16} /></button>
        <button title='Centre horizontal' onClick={() => align(ids, 'hcenter')}><AlignCenterVertical size={16} /></button>
        <button title='Droite' onClick={() => align(ids, 'right')}><AlignEndVertical size={16} /></button>
        <button title='Haut' onClick={() => align(ids, 'top')}><AlignStartHorizontal size={16} /></button>
        <button title='Centre vertical' onClick={() => align(ids, 'vcenter')}><AlignCenterHorizontal size={16} /></button>
        <button title='Bas' onClick={() => align(ids, 'bottom')}><AlignEndHorizontal size={16} /></button>
      </div>
      {!inFrame && (
        <div className='icon-row'>
          <button title='Répartir horizontalement' onClick={() => distribute(ids, 'horizontal')}><AlignHorizontalDistributeCenter size={16} /></button>
          <button title='Répartir verticalement' onClick={() => distribute(ids, 'vertical')}><AlignVerticalDistributeCenter size={16} /></button>
          <button title='Ranger en grille' onClick={() => tidy(ids)}><Grid2x2 size={16} /></button>
          <button title='Même largeur' onClick={() => matchSize(ids, 'w')}>↔</button>
          <button title='Même hauteur' onClick={() => matchSize(ids, 'h')}>↕</button>
          <button title='Encadrer (Maj+F)' onClick={frameSelection}><FrameIcon size={16} /></button>
        </div>
      )}
    </section>
  )
}

export function Inspector () {
  const items = useItems()
  const selected = useStore(ui, (s) => s.selected)
  const list = selected.map((id) => items[id]).filter(Boolean)
  if (!list.length) return null
  const types = new Set(list.map((i) => i.type))
  const one = list.length === 1 ? list[0] : null
  const textual = list.filter((i) => i.type === 'sticky' || i.type === 'text' || i.type === 'shape')
  const connectors = list.filter((i) => i.type === 'connector')
  const fillable = list.filter((i) => i.type === 'sticky' || i.type === 'shape')
  const shapes = list.filter((i) => i.type === 'shape')
  const placed = list.filter((i) => i.type !== 'connector')
  const locked = list.every((i) => i.locked)
  const title = types.size === 1 ? `${TYPE_LABEL[list[0].type]}${list.length > 1 ? ` ×${list.length}` : ''}` : `${list.length} éléments`
  const parent = one?.parentId ? getItems()[one.parentId] : null

  return (
    <aside className='inspector panel' data-scroll onKeyDown={(e) => e.stopPropagation()}>
      <header>{title}</header>
      {one?.type === 'frame' && <FrameSection f={one} />}
      {(placed.length >= 2 || (one && parent)) && <AlignSection ids={selected} inFrame={!!(one && parent)} />}
      {fillable.length > 0 && (
        <section>
          <h4>Couleur</h4>
          <Swatches colors={types.has('sticky') && !types.has('shape') ? STICKY_COLORS : FILL_COLORS} value={fillable[0].fill} onPick={(fill) => patchAll(fillable, { fill })} />
        </section>
      )}
      {shapes.length > 0 && (
        <section>
          <h4>Forme</h4>
          <Seg<ShapeKind> value={shapes[0].shape} onChange={(shape) => patchAll(shapes, { shape })}
            options={[{ v: 'rect', label: 'Rect.' }, { v: 'round', label: 'Arrondi' }, { v: 'ellipse', label: 'Ellipse' }, { v: 'diamond', label: 'Losange' }]} />
          <div className='label'>Contour</div>
          <Swatches colors={INK_COLORS} value={shapes[0].stroke} onPick={(stroke) => patchAll(shapes, { stroke })} />
        </section>
      )}
      {textual.length > 0 && <TypographyPanel list={textual} />}
      {connectors.length > 0 && <ConnectorSection list={connectors} />}
      {one && (one.type === 'link' || one.type === 'video') && <LinkSection it={one} />}
      {one && one.type !== 'connector' && one.type !== 'frame' && (
        <section>
          <h4>Dimensions</h4>
          <div className='row'>
            <Num label='L' value={one.w} onChange={(w) => updateItem(one.id, { w })} />
            <Num label='H' value={one.h} onChange={(h) => updateItem(one.id, { h })} />
          </div>
        </section>
      )}
      <section>
        <h4>Disposition</h4>
        <div className='icon-row'>
          <button title='Premier plan (])' onClick={() => reorder(true)}><BringToFront size={16} /></button>
          <button title='Arrière-plan ([)' onClick={() => reorder(false)}><SendToBack size={16} /></button>
          <button title='Dupliquer (Ctrl+D)' onClick={duplicateSelection}><Copy size={16} /></button>
          <button title={locked ? 'Déverrouiller' : 'Verrouiller'} onClick={toggleLock}>{locked ? <LockOpen size={16} /> : <Lock size={16} />}</button>
          <button title='Supprimer (Suppr)' className='danger' onClick={deleteSelection}><Trash2 size={16} /></button>
        </div>
      </section>
    </aside>
  )
}
