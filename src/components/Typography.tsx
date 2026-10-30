import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart, Bold, ChevronDown, Copy, Italic, Pencil, Plus, RefreshCw, Strikethrough, Trash2, Underline,
  User, Users
} from 'lucide-react'
import { GOOGLE_FONTS, SYSTEM_FONTS, ensureFont, fontStack, loadPickerPreviews, type FontDef } from '../fonts'
import { textDefaults } from '../text'
import { me } from '../board'
import {
  applyStyle, clearOverrides, createStyle, deleteStyle, duplicateStyle, hasOverrides, redefineStyle, resolve, updateStyle,
  useStyles, visibleStyles
} from '../textStyles'
import { INK_COLORS } from '../actions'
import { Seg, Swatches, patchAll } from './controls'
import type { Item, TextAlign, TextCase, VAlign } from '../types'

/** Marker for a property that differs across the selected items. */
const MIXED = Symbol('mixed')
type Val<T> = T | undefined | typeof MIXED

function common<K extends keyof Item> (list: Item[], key: K, fallback?: (it: Item) => Item[K]): Val<Item[K]> {
  const vals = list.map((it) => it[key] ?? fallback?.(it))
  return vals.every((v) => v === vals[0]) ? vals[0] : MIXED
}

const WEIGHTS: [number, string][] = [
  [100, 'Thin'], [200, 'Extra Light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'],
  [600, 'Semi Bold'], [700, 'Bold'], [800, 'Extra Bold'], [900, 'Black']
]

function NumField ({ label, value, onChange, step = 1, min, placeholder = 'auto', unit, title }: {
  label: React.ReactNode; value: Val<number>; onChange: (v: number | undefined) => void
  step?: number; min?: number; placeholder?: string; unit?: string; title?: string
}) {
  return (
    <label className='num' title={title}>
      <span>{label}</span>
      <input
        type='number' step={step} min={min}
        value={value === MIXED || value === undefined ? '' : value}
        placeholder={value === MIXED ? '—' : placeholder}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          if (e.target.value === '') return onChange(undefined)
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
      />
      {unit && <small>{unit}</small>}
    </label>
  )
}

function Toggle ({ on, title, onClick, children }: { on: Val<boolean>; title: string; onClick: () => void; children: React.ReactNode }) {
  return <button title={title} className={on === true ? 'active' : on === MIXED ? 'mixed' : ''} onClick={onClick}>{children}</button>
}

function FontPicker ({ value, onPick }: { value: Val<string>; onPick: (family: string | undefined) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    loadPickerPreviews()
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const groups = useMemo(() => {
    const match = (f: FontDef) => f.family.toLowerCase().includes(q.trim().toLowerCase())
    return [
      { label: 'Système', fonts: SYSTEM_FONTS.filter(match) },
      { label: 'Google Fonts', fonts: GOOGLE_FONTS.filter(match) }
    ].filter((g) => g.fonts.length)
  }, [q])

  const label = value === MIXED ? '— (plusieurs)' : value ?? 'Police par défaut'
  const pick = (family: string | undefined) => { ensureFont(family); onPick(family); setOpen(false); setQ('') }

  return (
    <div className='font-picker' ref={ref}>
      <button className='font-current' style={{ fontFamily: value === MIXED ? undefined : fontStack(value) }} onClick={() => setOpen(!open)}>
        <span>{label}</span><ChevronDown size={14} />
      </button>
      {open && (
        <div className='font-menu' data-scroll>
          <input autoFocus placeholder='Rechercher une police…' value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false) }} />
          <button className={value === undefined ? 'active' : ''} onClick={() => pick(undefined)}>Police par défaut</button>
          {groups.map((g) => (
            <div key={g.label}>
              <div className='font-group'>{g.label}</div>
              {g.fonts.map((f) => (
                <button key={f.family} className={value === f.family ? 'active' : ''} style={{ fontFamily: fontStack(f.family) }} onClick={() => pick(f.family)}>
                  {f.family}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CharacterTab ({ list }: { list: Item[] }) {
  const set = (patch: Partial<Item>) => patchAll(list, patch)
  const weight = common(list, 'fontWeight')
  const italic = common(list, 'italic')
  const underline = common(list, 'underline')
  const strike = common(list, 'strike')
  const textCase = common(list, 'textCase')
  const color = common(list, 'color')
  return (
    <>
      <FontPicker value={common(list, 'fontFamily')} onPick={(fontFamily) => set({ fontFamily })} />
      <div className='row'>
        <select className='grow' value={weight === MIXED ? '' : weight ?? 400} onChange={(e) => set({ fontWeight: Number(e.target.value) === 400 ? undefined : Number(e.target.value) })}>
          {weight === MIXED && <option value=''>—</option>}
          {WEIGHTS.map(([w, n]) => <option key={w} value={w}>{n} ({w})</option>)}
        </select>
        <NumField label='Taille' value={common(list, 'fontSize')} min={4} onChange={(fontSize) => set({ fontSize })} />
      </div>
      <div className='row'>
        <div className='toggles'>
          <Toggle on={weight === MIXED ? MIXED : (weight ?? 400) >= 600} title='Gras' onClick={() => set({ fontWeight: (weight !== MIXED && (weight ?? 400) >= 600) ? undefined : 700 })}><Bold size={14} /></Toggle>
          <Toggle on={italic} title='Italique' onClick={() => set({ italic: italic !== true })}><Italic size={14} /></Toggle>
          <Toggle on={underline} title='Souligné' onClick={() => set({ underline: underline !== true })}><Underline size={14} /></Toggle>
          <Toggle on={strike} title='Barré' onClick={() => set({ strike: strike !== true })}><Strikethrough size={14} /></Toggle>
        </div>
        <NumField label='VA' title='Interlettrage (millièmes de cadratin)' value={common(list, 'tracking')} step={10} placeholder='0' onChange={(tracking) => set({ tracking })} />
      </div>
      <div className='label'>Casse</div>
      <Seg<TextCase> value={textCase === MIXED ? undefined : textCase ?? 'none'} onChange={(c) => set({ textCase: c === 'none' ? undefined : c })}
        options={[
          { v: 'none', label: 'Aa', title: 'Normale' },
          { v: 'uppercase', label: 'AA', title: 'Capitales' },
          { v: 'lowercase', label: 'aa', title: 'Minuscules' },
          { v: 'capitalize', label: 'Aa Bb', title: 'Initiales en capitales' }
        ]} />
      <div className='label'>Couleur</div>
      <Swatches colors={INK_COLORS} value={color === MIXED ? undefined : color} onPick={(c) => set({ color: c })} />
    </>
  )
}

function ParagraphTab ({ list }: { list: Item[] }) {
  const set = (patch: Partial<Item>) => patchAll(list, patch)
  const align = common(list, 'align', (it) => textDefaults(it).align)
  const vAlign = common(list, 'vAlign', (it) => textDefaults(it).vAlign)
  const boxed = list.some((it) => it.type !== 'text')
  return (
    <>
      <div className='label'>Alignement</div>
      <div className='row'>
        <Seg<TextAlign> value={align === MIXED ? undefined : align} onChange={(a) => set({ align: a })}
          options={[
            { v: 'left', label: <AlignLeft size={14} />, title: 'Gauche' },
            { v: 'center', label: <AlignCenter size={14} />, title: 'Centre' },
            { v: 'right', label: <AlignRight size={14} />, title: 'Droite' },
            { v: 'justify', label: <AlignJustify size={14} />, title: 'Justifié' }
          ]} />
        {boxed && (
          <Seg<VAlign> value={vAlign === MIXED ? undefined : vAlign} onChange={(v) => set({ vAlign: v })}
            options={[
              { v: 'top', label: <AlignVerticalJustifyStart size={14} />, title: 'Haut' },
              { v: 'middle', label: <AlignVerticalJustifyCenter size={14} />, title: 'Milieu' },
              { v: 'bottom', label: <AlignVerticalJustifyEnd size={14} />, title: 'Bas' }
            ]} />
        )}
      </div>
      <div className='grid2'>
        <NumField label='Interligne' value={common(list, 'lineHeight')} step={0.1} min={0.5} onChange={(lineHeight) => set({ lineHeight })} title='Multiple de la taille du texte' />
        <NumField label='Retrait' value={common(list, 'indent')} placeholder='0' unit='px' onChange={(indent) => set({ indent })} title='Retrait de première ligne' />
        <NumField label='Avant' value={common(list, 'spaceBefore')} min={0} placeholder='0' unit='px' onChange={(spaceBefore) => set({ spaceBefore })} title='Espace avant chaque paragraphe' />
        <NumField label='Après' value={common(list, 'spaceAfter')} min={0} placeholder='0' unit='px' onChange={(spaceAfter) => set({ spaceAfter })} title='Espace après chaque paragraphe' />
        <NumField label='Marge' value={common(list, 'padding', (it) => textDefaults(it).padding)} min={0} unit='px' onChange={(padding) => set({ padding })} title='Marge intérieure' />
      </div>
    </>
  )
}

/** InDesign-style Character / Paragraph panel for every text-bearing item. */
function StylesList ({ list }: { list: Item[] }) {
  const styles = visibleStyles(useStyles())
  const ids = list.map((i) => i.id)
  const linked = common(list, 'styleId')
  const overridden = list.some(hasOverrides)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [personal, setPersonal] = useState(false)

  const create = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    createStyle(name.trim(), list[0], personal, ids)
    setCreating(false); setName(''); setPersonal(false)
  }

  return (
    <div className='styles-list'>
      <div className='styles-head'>
        <span className='label'>Styles</span>
        <button className='icon' title='Nouveau style depuis la sélection' onClick={() => setCreating(!creating)}><Plus size={15} /></button>
      </div>
      {creating && (
        <form className='style-form' onSubmit={create}>
          <input autoFocus placeholder='Nom du style (ex. Titre 1)' value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setCreating(false) }} />
          <label className='check'><input type='checkbox' checked={personal} onChange={(e) => setPersonal(e.target.checked)} /> Personnel (visible seulement par moi)</label>
          <button className='btn primary' type='submit'>Créer depuis la sélection</button>
        </form>
      )}
      <ul>
        <li className={!linked ? 'active' : ''} onClick={() => applyStyle(ids, null)} title='Délier : le texte garde son apparence actuelle'>
          <span className='style-name muted'>[Aucun style]</span>
        </li>
        {styles.map((st) => (
          <li key={st.id} className={linked === st.id ? 'active' : ''} onClick={() => applyStyle(ids, st.id)} title='Appliquer ce style à la sélection'>
            <span className='style-name' style={{ fontFamily: fontStack(st.props.fontFamily), fontWeight: st.props.fontWeight, fontStyle: st.props.italic ? 'italic' : undefined }}>
              {st.name}{linked === st.id && overridden && <b className='plus' title='Remplacements locaux'>+</b>}
            </span>
            {st.owner && <span className='badge' title='Style personnel'>perso</span>}
            <span className='style-actions' onClick={(e) => e.stopPropagation()}>
              <button title='Redéfinir le style depuis la sélection' onClick={() => redefineStyle(st.id, list[0])}><RefreshCw size={13} /></button>
              <button title='Renommer' onClick={() => { const n = prompt('Nom du style', st.name)?.trim(); if (n) updateStyle(st.id, { name: n }) }}><Pencil size={13} /></button>
              <button title={st.owner ? 'Partager avec le tableau' : 'Rendre personnel'} onClick={() => updateStyle(st.id, { owner: st.owner ? null : me.id })}>{st.owner ? <Users size={13} /> : <User size={13} />}</button>
              <button title='Dupliquer' onClick={() => duplicateStyle(st.id)}><Copy size={13} /></button>
              <button title='Supprimer (les textes gardent leur apparence)' className='danger' onClick={() => { if (confirm(`Supprimer le style « ${st.name} » ?`)) deleteStyle(st.id) }}><Trash2 size={13} /></button>
            </span>
          </li>
        ))}
      </ul>
      {overridden && <button className='btn wide' onClick={() => clearOverrides(ids)}>Effacer les remplacements</button>}
    </div>
  )
}

export function TypographyPanel ({ list }: { list: Item[] }) {
  useStyles()
  // Controls show the effective look (style + local overrides); edits become overrides.
  const resolved = list.map(resolve)
  const [tab, setTab] = useState<'char' | 'para'>(() => (localStorage.getItem('planche:typoTab') as 'char' | 'para') || 'char')
  useEffect(() => { try { localStorage.setItem('planche:typoTab', tab) } catch { /* storage unavailable */ } }, [tab])
  return (
    <section className='typo'>
      <div className='tabs'>
        <button className={tab === 'char' ? 'active' : ''} onClick={() => setTab('char')}>Caractère</button>
        <button className={tab === 'para' ? 'active' : ''} onClick={() => setTab('para')}>Paragraphe</button>
      </div>
      <StylesList list={list} />
      {tab === 'char' ? <CharacterTab list={resolved} /> : <ParagraphTab list={resolved} />}
    </section>
  )
}
