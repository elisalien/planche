import { updateItems } from '../board'
import type { Item } from '../types'

export function patchAll (list: Item[], patch: Partial<Item>) {
  updateItems(Object.fromEntries(list.map((i) => [i.id, patch])))
}

export function Swatches ({ colors, value, onPick }: { colors: string[]; value?: string; onPick: (c: string) => void }) {
  return (
    <div className='swatches'>
      {colors.map((c) => (
        <button key={c} className={`swatch${value === c ? ' active' : ''}${c === 'transparent' ? ' clear' : ''}`} style={{ background: c }} onClick={() => onPick(c)} title={c} />
      ))}
      <label className='swatch custom' title='Couleur personnalisée'>
        <input type='color' value={value && value.startsWith('#') ? value : '#ffffff'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  )
}

export function Seg<T extends string> ({ value, options, onChange }: { value: T | undefined; options: { v: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className='seg'>
      {options.map((o) => <button key={o.v} title={o.title} className={value === o.v ? 'active' : ''} onClick={() => onChange(o.v)}>{o.label}</button>)}
    </div>
  )
}
