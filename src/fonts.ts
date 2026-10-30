// Font catalogue: system fonts plus a curated Google Fonts selection,
// each loaded only when an item (or the picker preview) needs it.

export type FontCategory = 'sans' | 'serif' | 'display' | 'mono' | 'hand'

export interface FontDef {
  family: string
  category: FontCategory
  google?: boolean
  /** Google Fonts weight spec: a variable range ("100..900") or a static list ("400;700"). */
  weights?: string
}

const FALLBACK: Record<FontCategory, string> = {
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  display: 'ui-sans-serif, system-ui, sans-serif',
  mono: 'ui-monospace, Consolas, monospace',
  hand: 'cursive'
}

export const SYSTEM_FONTS: FontDef[] = [
  { family: 'Arial', category: 'sans' },
  { family: 'Helvetica', category: 'sans' },
  { family: 'Segoe UI', category: 'sans' },
  { family: 'Verdana', category: 'sans' },
  { family: 'Tahoma', category: 'sans' },
  { family: 'Trebuchet MS', category: 'sans' },
  { family: 'Georgia', category: 'serif' },
  { family: 'Times New Roman', category: 'serif' },
  { family: 'Palatino Linotype', category: 'serif' },
  { family: 'Courier New', category: 'mono' },
  { family: 'Consolas', category: 'mono' },
  { family: 'Impact', category: 'display' }
]

const g = (family: string, category: FontCategory, weights = '400'): FontDef => ({ family, category, google: true, weights })

export const GOOGLE_FONTS: FontDef[] = [
  g('Inter', 'sans', '100..900'),
  g('Roboto', 'sans', '100..900'),
  g('Open Sans', 'sans', '300..800'),
  g('Lato', 'sans', '100;300;400;700;900'),
  g('Montserrat', 'sans', '100..900'),
  g('Poppins', 'sans', '100;200;300;400;500;600;700;800;900'),
  g('Raleway', 'sans', '100..900'),
  g('Nunito', 'sans', '200..1000'),
  g('Work Sans', 'sans', '100..900'),
  g('DM Sans', 'sans', '100..1000'),
  g('Manrope', 'sans', '200..800'),
  g('Rubik', 'sans', '300..900'),
  g('Space Grotesk', 'sans', '300..700'),
  g('IBM Plex Sans', 'sans', '100;200;300;400;500;600;700'),
  g('Source Sans 3', 'sans', '200..900'),
  g('Oswald', 'display', '200..700'),
  g('Bebas Neue', 'display'),
  g('Anton', 'display'),
  g('Archivo Black', 'display'),
  g('Abril Fatface', 'display'),
  g('Playfair Display', 'serif', '400..900'),
  g('Merriweather', 'serif', '300;400;700;900'),
  g('Lora', 'serif', '400..700'),
  g('Libre Baskerville', 'serif', '400;700'),
  g('Cormorant Garamond', 'serif', '300;400;500;600;700'),
  g('EB Garamond', 'serif', '400..800'),
  g('DM Serif Display', 'serif'),
  g('Crimson Pro', 'serif', '200..900'),
  g('Fraunces', 'serif', '100..900'),
  g('Space Mono', 'mono', '400;700'),
  g('JetBrains Mono', 'mono', '100..800'),
  g('IBM Plex Mono', 'mono', '100;200;300;400;500;600;700'),
  g('Fira Code', 'mono', '300..700'),
  g('Caveat', 'hand', '400..700'),
  g('Dancing Script', 'hand', '400..700'),
  g('Pacifico', 'hand'),
  g('Permanent Marker', 'hand'),
  g('Shadows Into Light', 'hand'),
  g('Indie Flower', 'hand'),
  g('Lobster', 'hand')
]

const BY_NAME = new Map([...SYSTEM_FONTS, ...GOOGLE_FONTS].map((f) => [f.family, f]))

/** CSS font-family value with a sensible fallback stack. */
export function fontStack (family: string | undefined) {
  if (!family) return undefined
  const def = BY_NAME.get(family)
  return `"${family}", ${FALLBACK[def?.category ?? 'sans']}`
}

const loaded = new Set<string>()

function addStylesheet (href: string, onError?: () => void) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  if (onError) link.onerror = onError
  document.head.appendChild(link)
}

const familyParam = (name: string) => encodeURIComponent(name).replace(/%20/g, '+')

/** Load a Google font (all its weights) the first time it is used. */
export function ensureFont (family: string | undefined) {
  if (!family || loaded.has(family)) return
  const def = BY_NAME.get(family)
  if (!def?.google) return
  loaded.add(family)
  const base = 'https://fonts.googleapis.com/css2?display=swap&family='
  const plain = base + familyParam(family)
  // If the weight spec is ever rejected, fall back to the regular face.
  if (def.weights && def.weights !== '400') addStylesheet(`${plain}:wght@${def.weights}`, () => addStylesheet(plain))
  else addStylesheet(plain)
}

let previewLoaded = false

/**
 * Declare the regular face of every catalogue font so the picker can draw each
 * name in its own font. Files are fetched lazily, per unicode range, on render.
 * (A `text=` subset is avoided: it would shadow the full font for canvas text.)
 */
export function loadPickerPreviews () {
  if (previewLoaded) return
  previewLoaded = true
  const families = GOOGLE_FONTS.map((f) => `family=${familyParam(f.family)}`).join('&')
  addStylesheet(`https://fonts.googleapis.com/css2?${families}&display=swap`)
}
