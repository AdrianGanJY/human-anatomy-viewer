/** Pure CSS-pixel annotation geometry; no environment or mutable global state. */
export interface Viewport { w: number; h: number; pad?: number }
export interface Anchor { id: string; x: number; y: number; r: number }
export interface LabelReq { id: string; target: string; w: number; h: number; priority?: number }
export interface Placed {
  id: string; target: string; x: number; y: number; w: number; h: number;
  side: 'right' | 'left' | 'above' | 'below' | 'ne' | 'nw' | 'se' | 'sw';
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
  clipped: boolean; score: number;
}
export interface PlaceOptions { gap?: number; leaderMin?: number; maxCandidates?: number }

type Box = { x: number; y: number; w: number; h: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Line = { x1: number; y1: number; x2: number; y2: number };
const SIDES: Placed['side'][] = ['right', 'left', 'above', 'below', 'ne', 'nw', 'se', 'sw'];
const RAD = Math.PI / 180;

function finite(value: number, name: string, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${name} must be finite and >= ${minimum}`);
  return value;
}
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, hi));
}
function bounds(viewport: Viewport): Bounds {
  const w = finite(viewport.w, 'viewport.w', 0);
  const h = finite(viewport.h, 'viewport.h', 0);
  const pad = finite(viewport.pad ?? 8, 'viewport.pad', 0);
  const left = Math.min(pad, w / 2), top = Math.min(pad, h / 2);
  return { left, top, right: w - left, bottom: h - top };
}
function validateAnchor(a: Anchor): void {
  finite(a.x, 'anchor.x'); finite(a.y, 'anchor.y'); finite(a.r, 'anchor.r', 0);
}
function boxOverlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (w <= 0) return 0;
  return w * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}
function distanceToBox(a: Anchor, b: Box): number {
  const dx = Math.max(b.x - a.x, 0, a.x - b.x - b.w);
  const dy = Math.max(b.y - a.y, 0, a.y - b.y - b.h);
  return Math.hypot(dx, dy);
}

// Signed integral of the circle's indicator over [0,x] × [0,y].
// Inclusion/exclusion gives exact circle/rectangle intersection area.
function circlePrimitive(x: number, y: number, r: number): number {
  const sign = Math.sign(x) * Math.sign(y);
  const a = Math.min(Math.abs(x), r), b = Math.min(Math.abs(y), r);
  if (a * a + b * b <= r * r) return sign * a * b;
  const t = Math.sqrt(Math.max(0, r * r - b * b));
  const integral = (v: number) => (v * Math.sqrt(Math.max(0, r * r - v * v)) +
    r * r * Math.asin(Math.min(1, v / r))) / 2;
  return sign * (b * t + integral(a) - integral(t));
}
function discOverlap(box: Box, a: Anchor): number {
  if (a.r === 0 || box.w === 0 || box.h === 0) return 0;
  const x0 = box.x - a.x, x1 = x0 + box.w;
  const y0 = box.y - a.y, y1 = y0 + box.h;
  const r = a.r;
  if (x0 >= r || x1 <= -r || y0 >= r || y1 <= -r) return 0;
  const dx = Math.max(x0, 0, -x1), dy = Math.max(y0, 0, -y1);
  if (dx * dx + dy * dy >= r * r) return 0;
  const fx = Math.max(Math.abs(x0), Math.abs(x1)), fy = Math.max(Math.abs(y0), Math.abs(y1));
  if (fx * fx + fy * fy <= r * r) return box.w * box.h;
  if (x0 <= -r && x1 >= r && y0 <= -r && y1 >= r) return Math.PI * r * r;
  return Math.max(0, Math.min(box.w * box.h, Math.PI * r * r,
    circlePrimitive(x1, y1, r) - circlePrimitive(x0, y1, r) -
    circlePrimitive(x1, y0, r) + circlePrimitive(x0, y0, r)));
}

/** Recompute on camera/viewport/text changes; results retain the caller's order. */
export function placeLabels(viewport: Viewport, anchors: Anchor[], labels: LabelReq[], opts: PlaceOptions = {}): Placed[] {
  const b = bounds(viewport);
  const gap = finite(opts.gap ?? 10, 'gap', 0);
  const leaderMin = finite(opts.leaderMin ?? 14, 'leaderMin', 0);
  const requested = finite(opts.maxCandidates ?? 24, 'maxCandidates', 1);
  if (!Number.isInteger(requested)) throw new RangeError('maxCandidates must be an integer');
  const count = Math.min(24, requested);
  const byId = new Map<string, Anchor>();
  for (const a of anchors) {
    validateAnchor(a);
    if (byId.has(a.id)) throw new Error(`Duplicate anchor id: ${a.id}`);
    byId.set(a.id, a);
  }
  const ids = new Set<string>();
  const work = labels.map((label, index) => {
    finite(label.w, 'label.w', 0); finite(label.h, 'label.h', 0);
    finite(label.priority ?? 0, 'priority');
    if (ids.has(label.id)) throw new Error(`Duplicate label id: ${label.id}`);
    ids.add(label.id);
    const anchor = byId.get(label.target);
    if (!anchor) throw new Error(`Unknown target: ${label.target}`);
    return { label, anchor, index };
  });
  work.sort((a, c) => (c.label.priority ?? 0) - (a.label.priority ?? 0) ||
    a.anchor.y - c.anchor.y || (a.label.id < c.label.id ? -1 : a.label.id > c.label.id ? 1 : 0));
  const placed: Placed[] = [];
  const result = new Array<Placed>(labels.length);
  const inner: Box = { x: b.left, y: b.top, w: b.right - b.left, h: b.bottom - b.top };
  for (const { label, anchor: a, index } of work) {
    const { w, h } = label;
    let bestScore = Infinity, bestRank = Infinity, bestSide = 0;
    let bestX = b.left, bestY = b.top;
    for (let i = 0; i < count; i++) {
      const side = i % 8, clearance = gap * (1 + Math.floor(i / 8));
      const radius = a.r + clearance, diagonal = radius * Math.SQRT1_2;
      let x: number, y: number;
      switch (side) {
        case 0: x = a.x + radius; y = a.y - h / 2; break;
        case 1: x = a.x - radius - w; y = a.y - h / 2; break;
        case 2: x = a.x - w / 2; y = a.y - radius - h; break;
        case 3: x = a.x - w / 2; y = a.y + radius; break;
        case 4: x = a.x + diagonal; y = a.y - diagonal - h; break;
        case 5: x = a.x - diagonal - w; y = a.y - diagonal - h; break;
        case 6: x = a.x + diagonal; y = a.y + diagonal; break;
        default: x = a.x - diagonal - w; y = a.y + diagonal;
      }
      const raw = { x, y, w, h };
      const final = { x: clamp(x, b.left, b.right - w), y: clamp(y, b.top, b.bottom - h), w, h };
      let labelArea = 0, blocked = false;
      for (const other of placed) {
        labelArea += boxOverlap(raw, other);
        if (!blocked && boxOverlap(final, other) > 0) blocked = true;
      }
      // A weighted sum alone cannot promise non-overlap. Prefer candidates
      // that remain clear after clamping; avoid covering their own disc next.
      const rank = (blocked ? 2 : 0) + (distanceToBox(a, final) + 1e-9 < a.r ? 1 : 0);
      if (rank > bestRank) continue;
      let anchorArea = 0;
      for (const other of anchors) if (other.id !== a.id) anchorArea += discOverlap(raw, other);
      const outside = Math.max(0, w * h - boxOverlap(raw, inner));
      const score = labelArea * 4 + anchorArea * 2 + outside * 8 + clearance * 0.05 + side;
      if (rank < bestRank || score < bestScore) {
        bestRank = rank; bestScore = score; bestSide = side; bestX = final.x; bestY = final.y;
      }
    }
    const p: Placed = {
      id: label.id, target: label.target, x: bestX, y: bestY, w, h,
      side: SIDES[bestSide], score: bestScore, clipped: w > inner.w || h > inner.h, leader: null,
    };
    const x2 = clamp(a.x, p.x, p.x + w), y2 = clamp(a.y, p.y, p.y + h);
    const dx = x2 - a.x, dy = y2 - a.y, distance = Math.hypot(dx, dy);
    if (distance > 0 && distance - a.r > leaderMin) {
      p.leader = { x1: a.x + dx * a.r / distance, y1: a.y + dy * a.r / distance, x2, y2 };
    }
    placed.push(p); result[index] = p;
  }
  return result;
}

// Liang–Barsky clipping preserves the straight segment's direction.
function clipLine(b: Bounds, x1: number, y1: number, x2: number, y2: number): Line {
  const dx = x2 - x1, dy = y2 - y1;
  let lo = 0, hi = 1;
  const edges = [[-dx, x1 - b.left], [dx, b.right - x1], [-dy, y1 - b.top], [dy, b.bottom - y1]];
  let visible = true;
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) { visible = false; break; } }
    else {
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo > hi) { visible = false; break; }
    }
  }
  if (!visible) {
    const x = clamp(x1, b.left, b.right), y = clamp(y1, b.top, b.bottom);
    return { x1: x, y1: y, x2: x, y2: y };
  }
  return { x1: clamp(x1 + lo * dx, b.left, b.right), y1: clamp(y1 + lo * dy, b.top, b.bottom),
    x2: clamp(x1 + hi * dx, b.left, b.right), y2: clamp(y1 + hi * dy, b.top, b.bottom) };
}

/** Positive inset adds clearance outside each disc; viewport clipping takes precedence. */
export function arrowBetween(viewport: Viewport, from: Anchor, to: Anchor, opts: { inset?: number } = {}): Line & { angle: number } {
  const b = bounds(viewport); validateAnchor(from); validateAnchor(to);
  const inset = finite(opts.inset ?? 0, 'inset', 0);
  const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy);
  const angle = distance === 0 ? 0 : Math.atan2(dy, dx);
  const ux = distance === 0 ? 1 : dx / distance, uy = distance === 0 ? 0 : dy / distance;
  let start = from.r + inset, end = distance - to.r - inset;
  // Overlapping/coincident discs have no visible interval: collapse to contact.
  if (start > end) start = end = distance * (from.r + inset) / (from.r + to.r + 2 * inset || 1);
  return { ...clipLine(b, from.x + ux * start, from.y + uy * start,
    from.x + ux * end, from.y + uy * end), angle };
}

/** SVG screen coordinates: clockwise sweeps increase degrees; ccw decreases. */
export function rotationArrow(viewport: Viewport, around: Anchor, direction: 'cw' | 'ccw',
  opts: { radiusScale?: number; sweepDeg?: number } = {}):
  { cx: number; cy: number; r: number; startDeg: number; endDeg: number; path: string } {
  const b = bounds(viewport); validateAnchor(around);
  const scale = finite(opts.radiusScale ?? 1.5, 'radiusScale', 0);
  const sweep = finite(opts.sweepDeg ?? 270, 'sweepDeg', 0);
  if (sweep > 360) throw new RangeError('sweepDeg must be <= 360');
  if (direction !== 'cw' && direction !== 'ccw') throw new RangeError('direction must be cw or ccw');
  const cx = clamp(around.x, b.left, b.right), cy = clamp(around.y, b.top, b.bottom);
  const r = Math.max(0, Math.min(around.r * scale, cx - b.left, b.right - cx, cy - b.top, b.bottom - cy));
  const sign = direction === 'cw' ? 1 : -1, flag = direction === 'cw' ? 1 : 0;
  const startDeg = -90, endDeg = startDeg + sign * sweep;
  const point = (deg: number) => ({ x: cx + r * Math.cos(deg * RAD), y: cy + r * Math.sin(deg * RAD) });
  const start = point(startDeg), end = point(endDeg);
  const arc = (deg: number, large: number) => {
    const p = point(deg);
    return ` A ${r} ${r} 0 ${large} ${flag} ${p.x} ${p.y}`;
  };
  let path = `M ${start.x} ${start.y}`;
  path += sweep === 360 ? arc(startDeg + sign * 180, 0) + arc(endDeg, 0) : arc(endDeg, sweep > 180 ? 1 : 0);
  const theta = endDeg * RAD, nx = Math.cos(theta), ny = Math.sin(theta);
  const tx = -ny * sign, ty = nx * sign, head = Math.min(7, r * 0.3);
  // Both wings sit inside the arc's enclosing circle, so the head also fits.
  const bx = end.x - tx * head - nx * head, by = end.y - ty * head - ny * head;
  path += ` M ${bx + nx * head * 0.45} ${by + ny * head * 0.45}` +
    ` L ${end.x} ${end.y} L ${bx - nx * head * 0.45} ${by - ny * head * 0.45}`;
  return { cx, cy, r, startDeg, endDeg, path };
}

/** Length defaults to four radii; clipping can shorten the requested line. */
export function stretchIndicator(viewport: Viewport, along: Anchor, axisDeg: number,
  opts: { length?: number } = {}): Line & { heads: 'both' } {
  const b = bounds(viewport); validateAnchor(along); finite(axisDeg, 'axisDeg');
  const half = finite(opts.length ?? along.r * 4, 'length', 0) / 2;
  const dx = Math.cos(axisDeg * RAD) * half, dy = Math.sin(axisDeg * RAD) * half;
  return { ...clipLine(b, along.x - dx, along.y - dy, along.x + dx, along.y + dy), heads: 'both' };
}
