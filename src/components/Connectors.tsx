import { memo } from 'react'
import { arrowHead, connectorEnds, connectorGeometry } from '../geometry'
import { updateItem } from '../board'
import { ui, useStore } from '../store'
import type { Item, Items } from '../types'

const Connector = memo(function Connector ({ it, all, selected }: { it: Item; all: Items; selected: boolean }) {
  const { a, b, na, nb } = connectorEnds(it, all)
  const g = connectorGeometry(a, b, na, nb, it.route ?? 'curved')
  const color = it.color ?? '#334155'
  const w = it.width ?? 2
  const editing = useStore(ui, (s) => s.editing === it.id)
  const head = 8 + w * 2.5
  return (
    <g data-id={it.id} className={`connector${selected ? ' selected' : ''}`}>
      <path className='hit' d={g.d} />
      {selected && <path d={g.d} stroke='#3b82f6' strokeWidth={w + 6} strokeOpacity={0.25} fill='none' strokeLinecap='round' />}
      <path d={g.d} stroke={color} strokeWidth={w} fill='none' strokeLinecap='round' strokeLinejoin='round' strokeDasharray={it.dash ? `${w * 4} ${w * 3}` : undefined} />
      {it.endArrow !== false && <polygon points={arrowHead(g.b, g.angleB, head)} fill={color} />}
      {it.startArrow && <polygon points={arrowHead(g.a, g.angleA, head)} fill={color} />}
      {(it.label || editing) && (
        <foreignObject x={g.mid.x - 90} y={g.mid.y - 16} width={180} height={32} style={{ overflow: 'visible' }}>
          <div className='conn-label-wrap'>
            {editing
              ? (
                <input
                  className='conn-label editing' data-nodrag autoFocus defaultValue={it.label ?? ''}
                  onBlur={(e) => { updateItem(it.id, { label: e.target.value }); ui.set({ editing: null }) }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
                />
                )
              : <span className='conn-label'>{it.label}</span>}
          </div>
        </foreignObject>
      )}
    </g>
  )
})

export function Connectors ({ items, list }: { items: Items; list: Item[] }) {
  const selected = useStore(ui, (s) => s.selected)
  return (
    <svg className='connectors'>
      {list.map((it) => <Connector key={it.id} it={it} all={items} selected={selected.includes(it.id)} />)}
    </svg>
  )
}
