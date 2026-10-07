// Geometry of the Flow graph: where each stage sits for a given width, and the curved paths
// between stages. Pure math, so the animation paths can be tested without a browser.
import { type FlowEdge, type StageId } from './model';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Orientation = 'horizontal' | 'vertical';

export interface FlowLayout {
  width: number;
  height: number;
  orientation: Orientation;
  rects: Record<StageId, Rect>;
}

/** Below this width the pipeline is laid out top to bottom. */
export const VERTICAL_BELOW = 860;

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function layoutFlow(width: number): FlowLayout {
  return width < VERTICAL_BELOW ? layoutVertical(Math.max(280, width)) : layoutHorizontal(width);
}

function layoutHorizontal(width: number): FlowLayout {
  const pad = 24;
  const gap = Math.max(28, Math.round(width * 0.028));
  const nodeW = (width - 2 * pad - 5 * gap) / 6;
  const nodeH = 132;
  const pillH = 46;
  const pillW = Math.min(184, nodeW + 24);
  const top = 72; // room for the "next sprint" arc above the ceremonies
  const pipeY = top + pillH + 74;
  const xAt = (i: number) => pad + i * (nodeW + gap);
  const cx = (i: number) => xAt(i) + nodeW / 2;
  const pill = (centerX: number): Rect => ({ x: centerX - pillW / 2, y: top, w: pillW, h: pillH });
  const lowerY = pipeY + nodeH + 104;
  const humanW = Math.min(240, nodeW + 40);
  const rects: Record<StageId, Rect> = {
    kickoff: pill(cx(0)),
    sprint_planning: pill(cx(1)),
    sprint_review: pill((cx(4) + cx(5)) / 2),
    backlog: { x: xAt(0), y: pipeY, w: nodeW, h: nodeH },
    todo: { x: xAt(1), y: pipeY, w: nodeW, h: nodeH },
    in_progress: { x: xAt(2), y: pipeY, w: nodeW, h: nodeH },
    review: { x: xAt(3), y: pipeY, w: nodeW, h: nodeH },
    testing: { x: xAt(4), y: pipeY, w: nodeW, h: nodeH },
    done: { x: xAt(5), y: pipeY, w: nodeW, h: nodeH },
    blocked: { x: (cx(2) + cx(3)) / 2 - humanW / 2, y: lowerY, w: humanW, h: 104 },
    lounge: { x: xAt(0), y: lowerY, w: Math.min(260, nodeW * 1.5), h: 104 },
  };
  return { width, height: lowerY + 104 + 28, orientation: 'horizontal', rects };
}

function layoutVertical(width: number): FlowLayout {
  const gutter = 44; // left: the sprint loop and escalations; right: rework arcs
  const nodeW = width - 2 * gutter;
  const nodeH = 74;
  const pillW = Math.round(nodeW * 0.62);
  const pillH = 42;
  const gap = 36;
  const rects = {} as Record<StageId, Rect>;
  let y = 16;
  // Ceremonies sit in the pipeline where they happen, so every step is a short straight path.
  const order: Array<[StageId, 'node' | 'pill']> = [
    ['kickoff', 'pill'],
    ['backlog', 'node'],
    ['sprint_planning', 'pill'],
    ['todo', 'node'],
    ['in_progress', 'node'],
    ['review', 'node'],
    ['testing', 'node'],
    ['done', 'node'],
    ['sprint_review', 'pill'],
    ['blocked', 'node'],
    ['lounge', 'node'],
  ];
  for (const [id, shape] of order) {
    rects[id] = shape === 'pill' ? { x: gutter, y, w: pillW, h: pillH } : { x: gutter, y, w: nodeW, h: nodeH };
    y += (shape === 'pill' ? pillH : nodeH) + gap;
  }
  return { width, height: y - gap + 16, orientation: 'vertical', rects };
}

/**
 * How a path bows away from a straight line: by a distance (pixels; the sign picks the side), or
 * through a side gutter, with the middle of the curve at x = `gutterX` (narrow screens, so arcs go
 * round the stacked stages instead of across them).
 */
export type Bend = number | { gutterX: number };

export function bendFor(edge: Pick<FlowEdge, 'from' | 'to' | 'kind'>, layout: FlowLayout): Bend {
  const { rects, width } = layout;
  if (layout.orientation === 'horizontal') {
    switch (edge.kind) {
      case 'rework':
        return edge.from === 'testing' ? -150 : -90; // below the pipeline
      case 'loop':
        return 110; // over the top of the ceremonies
      case 'escalate':
      case 'resolve':
        return 34; // the pair forms a lens between In Progress and Needs Human
      case 'reopen':
        return 120;
      default:
        return 0;
    }
  }
  switch (edge.kind) {
    case 'rework':
      return { gutterX: width - (edge.from === 'testing' ? 10 : 22) }; // right-hand gutter
    case 'resolve':
      return { gutterX: width - 6 };
    case 'loop':
      return { gutterX: 8 }; // left-hand gutter
    case 'escalate':
    case 'reopen':
      return { gutterX: 24 };
    default: {
      // Paths that skip over a stage (e.g. a person dragging To Do → Done) go round through the gutter.
      const from = rects[edge.from];
      const to = rects[edge.to];
      const skips = Math.abs(center(to).y - center(from).y) > (from.h + to.h) / 2 + 60;
      return skips ? { gutterX: width - 22 } : 0;
    }
  }
}

export interface EdgeGeometry {
  start: Point;
  control: Point;
  end: Point;
  /** SVG path data (a quadratic Bézier curve). */
  d: string;
  /** Point at t ∈ [0, 1] along the curve. */
  at: (t: number) => Point;
  /** Where a label sits: the middle of the curve. */
  mid: Point;
}

/** Where the ray from a rectangle's centre towards `toward` leaves the rectangle (plus a gap). */
export function exitPoint(r: Rect, toward: Point, gap = 6): Point {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const len = Math.hypot(dx, dy);
  const tx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap };
}

const round = (n: number) => Math.round(n * 10) / 10;

export function edgeGeometry(a: Rect, b: Rect, bend: Bend): EdgeGeometry {
  const ca = center(a);
  const cb = center(b);
  let control: Point;
  let start: Point;
  let end: Point;
  if (typeof bend === 'number') {
    const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    // Normal of the direction a → b; positive bends go to its side.
    const nx = -(cb.y - ca.y) / len;
    const ny = (cb.x - ca.x) / len;
    control = { x: (ca.x + cb.x) / 2 + nx * bend, y: (ca.y + cb.y) / 2 + ny * bend };
    start = exitPoint(a, bend === 0 ? cb : control);
    end = exitPoint(b, bend === 0 ? ca : control);
  } else {
    // The curve's middle is ¼·start + ½·control + ¼·end, so this puts it on the gutter line.
    const side = (r: Rect): Point => ({ x: bend.gutterX < center(r).x ? r.x - 6 : r.x + r.w + 6, y: center(r).y });
    start = side(a);
    end = side(b);
    control = { x: 2 * bend.gutterX - (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }
  const at = (t: number): Point => {
    const u = 1 - t;
    return {
      x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
      y: u * u * start.y + 2 * u * t * control.y + t * t * end.y,
    };
  };
  const d = `M ${round(start.x)} ${round(start.y)} Q ${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}`;
  return { start, control, end, d, at, mid: at(0.5) };
}

export function geometryFor(edge: FlowEdge, layout: FlowLayout): EdgeGeometry {
  return edgeGeometry(layout.rects[edge.from], layout.rects[edge.to], bendFor(edge, layout));
}

/** Evenly spaced points along consecutive edges, for animating a token along its route. */
export function samplePoints(geometries: EdgeGeometry[], stepsPerEdge = 18): Point[] {
  const points: Point[] = [];
  geometries.forEach((g, i) => {
    for (let s = i === 0 ? 0 : 1; s <= stepsPerEdge; s++) points.push(g.at(s / stepsPerEdge));
  });
  return points;
}
