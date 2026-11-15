// B-081: a pin – the element the person picked in a browser tab with the Pin button (main/side-driver/pick-script.ts):
// where it is (a short CSS selector that is unique where it could be, its box, the click point and the edge clicked
// within 4 px), what it is (tag, role, name, its own text – page text, quoted), how it looks (key computed styles that
// are not the defaults), where it sits (up to two parent boxes) and a source hint from the page's data attributes.
// pagePick checks and clips what the page reported (the page is untrusted; its short wire keys, see PickWire); pickText
// makes the few lines an agent reads ("Pinned on <host+path> (tab <id>):" first).
// Owns: the pin's shape, its checks and its text. Never: DOM, I/O, or where a pin goes (ui/workspace/pin.ts).

export type PickEdge = 'top' | 'right' | 'bottom' | 'left';
export interface PickBox { x: number; y: number; width: number; height: number }
export interface PagePick {
  tab: string;
  url: string;
  selector: string;
  tag: string;
  role?: string;
  name?: string;
  /** The element's own text as the page shows it (untrusted page text). */
  text?: string;
  /** Viewport CSS px. */
  box: PickBox;
  /** The click point and the box edge it was within 4 px of. */
  at?: { x: number; y: number };
  edge?: PickEdge;
  styles: Record<string, string>;
  /** A source file hint (data-insp-path, data-sentry-source-file, data-source, data-file, data-loc). */
  source?: string;
  /** Up to two parents as "tag.class W×H". */
  parents?: string[];
}
/** What the page reports; main adds the tab and its address. */
export type PickedElement = Omit<PagePick, 'tab' | 'url'>;

const EDGES: readonly PickEdge[] = ['top', 'right', 'bottom', 'left'];
const MAX_STYLES = 14;

const clip = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const one = value.replace(/\s+/g, ' ').trim();
  if (!one) return undefined;
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6 ? Math.round(value * 10) / 10 : undefined);

/**
 * The page's wire form ({k:'pick', sel, tag, role?, name?, text?, box:{x,y,w,h}, at?:{x,y}, edge?, st:{…}, src?, par?})
 * checked and clipped (selector ≤ 200, text ≤ 120, name ≤ 80, each style value ≤ 60, source ≤ 160, finite numbers);
 * null when it is not a pin (no selector, tag or box).
 */
export function pagePick(raw: unknown): PickedElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const wire = raw as Record<string, unknown>;
  const selector = clip(wire.sel, 200);
  const tag = typeof wire.tag === 'string' && /^[a-z][a-z0-9-]{0,40}$/i.test(wire.tag) ? wire.tag.toLowerCase() : undefined;
  const b = wire.box && typeof wire.box === 'object' ? wire.box as Record<string, unknown> : {};
  const [x, y, width, height] = [num(b.x), num(b.y), num(b.w), num(b.h)];
  if (!selector || !tag || x === undefined || y === undefined || width === undefined || height === undefined || width < 0 || height < 0) return null;
  const a = wire.at && typeof wire.at === 'object' ? wire.at as Record<string, unknown> : undefined;
  const at = a && num(a.x) !== undefined && num(a.y) !== undefined ? { x: num(a.x)!, y: num(a.y)! } : undefined;
  const styles: Record<string, string> = {};
  if (wire.st && typeof wire.st === 'object') {
    for (const [key, value] of Object.entries(wire.st as Record<string, unknown>)) {
      const text = clip(value, 60);
      if (text && /^[a-z][a-z-]{0,31}$/.test(key) && Object.keys(styles).length < MAX_STYLES) styles[key] = text;
    }
  }
  const role = typeof wire.role === 'string' && /^[a-z]{1,40}$/i.test(wire.role) ? wire.role : undefined;
  const name = clip(wire.name, 80);
  const text = clip(wire.text, 120);
  const source = clip(wire.src, 160);
  const parents = Array.isArray(wire.par) ? wire.par.map((item) => clip(item, 80)).filter((item): item is string => Boolean(item)).slice(0, 2) : [];
  return {
    selector, tag, ...(role ? { role } : {}), ...(name ? { name } : {}), ...(text ? { text } : {}),
    box: { x, y, width, height }, ...(at ? { at } : {}), ...(EDGES.includes(wire.edge as PickEdge) ? { edge: wire.edge as PickEdge } : {}),
    styles, ...(source ? { source } : {}), ...(parents.length ? { parents } : {}),
  };
}

/** "localhost:5173/pricing" – the page's host and path (no query, no fragment). */
function hostPath(url: string): string {
  const match = /^[a-z][a-z\d+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]+)([^?#]*)/i.exec(url);
  if (!match) return 'page';
  const path = match[2] === '/' ? '' : match[2]!;
  return `${match[1]}${path.length > 80 ? `${path.slice(0, 79)}…` : path}`;
}

/** The pin as the lines an agent reads (the page text quoted and named as such). */
export function pickText(pick: PagePick): string {
  const what = [
    `${pick.tag}${pick.role && pick.role !== pick.tag ? ` (${pick.role})` : ''}${pick.name && pick.name !== pick.text ? ` named ${JSON.stringify(pick.name)}` : ''}`,
    ...(pick.text ? [`page text ${JSON.stringify(pick.text)}`] : []),
    pick.selector,
  ].join(' · ');
  const { x, y, width, height } = pick.box;
  const where = `${width}×${height} at ${x},${y}${pick.at ? ` · clicked at ${pick.at.x},${pick.at.y}` : ''}${pick.edge ? ` on its ${pick.edge} edge` : ''}`;
  const looks = Object.entries(pick.styles).map(([key, value]) => `${key} ${value}`).join(' · ');
  return [
    `Pinned on ${hostPath(pick.url)} (tab ${pick.tab}):`,
    what,
    where,
    ...(looks ? [looks] : []),
    ...(pick.source ? [`source ${JSON.stringify(pick.source)}`] : []), // the page's own attribute: quoted like its text
    ...(pick.parents?.length ? [`inside ${pick.parents.join(' › ')}`] : []),
  ].join('\n');
}
