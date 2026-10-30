export type ItemType = 'frame' | 'sticky' | 'text' | 'shape' | 'link' | 'video' | 'image' | 'connector'
export type Side = 'top' | 'right' | 'bottom' | 'left'
export type Anchor = Side | 'auto'
export type FramePattern = 'none' | 'dots' | 'grid' | 'lines'
export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'diamond'
export type Route = 'straight' | 'curved' | 'elbow'

export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

/** A connector end is either attached to an item (id + anchor) or free (x, y). */
export interface ConnEnd { id?: string | null; anchor?: Anchor; x: number; y: number }

export interface LinkMeta {
  url?: string
  title?: string | null
  description?: string | null
  image?: string | null
  siteName?: string | null
  favicon?: string | null
  video?: string | null
  type?: string | null
}

export interface VideoInfo {
  provider: 'youtube' | 'vimeo' | 'dailymotion' | 'loom' | 'file' | 'embed'
  embed: string
  thumb?: string | null
}

/** Items are stored as plain immutable objects in a Y.Map (replaced on every change). */
export interface Item extends Rect {
  id: string
  type: ItemType
  z: number
  parentId?: string | null
  locked?: boolean

  text?: string
  fill?: string
  stroke?: string
  color?: string
  fontSize?: number
  align?: 'left' | 'center' | 'right'

  // frame
  title?: string
  pattern?: FramePattern
  radius?: number
  order?: number
  preset?: string
  hideTitle?: boolean

  // shape
  shape?: ShapeKind

  // link / video / image
  url?: string
  meta?: LinkMeta | null
  status?: 'loading' | 'ok' | 'error'
  video?: VideoInfo | null
  src?: string

  // connector
  from?: ConnEnd
  to?: ConnEnd
  route?: Route
  width?: number
  startArrow?: boolean
  endArrow?: boolean
  dash?: boolean
  label?: string
}

export type Items = Record<string, Item>
