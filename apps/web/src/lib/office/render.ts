// Draws the agent office from the simulation's state. Everything is pixel art in world pixels,
// multiplied by the painter's integer scale.
import { drawCat, drawCharacter } from './characters';
import { frame, hash, PALETTE, px, ROWS, shade, TILE, WORLD_H, WORLD_W, type Painter } from './pixels';
import { TEXT_CPS } from './settings';
import type { Bubble, Emote, OfficeSim, Walker } from './sim';
import { FURNITURE, WORKSHOP_DESKS, ZONES, type Furniture, type StationId } from './world';

export const FONT_FAMILY = '"Pixelify Sans", ui-monospace, monospace';

export interface RenderOptions {
  names: boolean;
  focusId: string | null;
  hoverId: string | null;
  textSpeed: 'slow' | 'normal' | 'fast' | 'instant';
}

const SIGNS: Record<string, [number, number]> = {
  library: [1.2, 7.25],
  meeting: [9.2, 7.25],
  board: [19.2, 4.25],
  help: [24.2, 7.25],
  workshop: [1.2, 12.25],
  ops: [16.2, 12.25],
  review: [22.2, 12.25],
  qa: [26.2, 12.25],
  lounge: [5.2, 16.25],
  dock: [27.2, 16.25],
};

export function renderOffice(p: Painter, sim: OfficeSim, opts: RenderOptions): void {
  const { ctx } = p;
  ctx.imageSmoothingEnabled = false;
  drawFloor(p);
  drawWall(p, sim);

  const items: Array<{ y: number; draw: () => void }> = [];
  for (const f of FURNITURE) items.push({ y: (f.y + f.h) * TILE - 1, draw: () => drawFurniture(p, f, sim) });
  for (const w of sim.walkers.values()) {
    const seat = seatOf(w);
    // Seated on the sofa: drawn just after it, so the person is in front of its back.
    items.push({ y: seat ? (seat.y + 1) * TILE : w.y, draw: () => drawWalker(p, w, sim, opts.hoverId === w.id) });
  }
  items.push({ y: sim.cat.y, draw: () => drawCat(p, sim.cat.x, sim.cat.y, sim.cat.dir, Math.floor(sim.cat.walked / 4), sim.catSleeping) });
  items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());

  drawFrontWall(p);

  for (const w of sim.walkers.values()) drawPastimeEffect(p, w, sim.now);

  const tags: NameTag[] = [];
  for (const w of sim.walkers.values()) {
    const seat = seatOf(w);
    const head = seat ? seatFeet(seat).y - 30 : w.y - 30;
    if (w.emote) drawEmote(p, w.emote.kind, w.x, head, sim.now);
    if (!opts.names) continue;
    if (w.kind === 'human') tags.push({ lines: [{ text: `${w.name} (you)`, style: 'human' }], x: w.x, y: w.y + 3 });
    else {
      const lines: NameTag['lines'] = [{ text: w.name, style: w.driver ? 'active' : 'idle' }];
      if (w.driver) lines.push({ text: w.driver.agentName, style: 'agent' });
      tags.push({ lines, x: w.x, y: w.y + 3 });
    }
  }
  for (const t of placeNameTags(tags, (s) => measure(p, s, TAG_SIZE) + 4)) drawNameTag(p, t.text, t.x, t.y, t.style);
  if (sim.cat.emote) drawEmote(p, sim.cat.emote.kind, sim.cat.x + 3, sim.cat.y - 13, sim.now);

  const bubbles = [...sim.bubbles.values()].sort((a, b) => (sim.anchorOf(a.ownerId)?.y ?? 0) - (sim.anchorOf(b.ownerId)?.y ?? 0));
  for (const b of bubbles) drawBubble(p, sim, b, opts.textSpeed);

  if (opts.focusId) {
    const target = sim.targets().find((t) => t.id === opts.focusId);
    if (target) drawCursor(p, target.x, target.y, sim.now);
  }
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

function drawFloor(p: Painter): void {
  for (const z of ZONES) {
    for (let y = z.y; y < z.y + z.h; y++) {
      for (let x = z.x; x < z.x + z.w; x++) px(p, x * TILE, y * TILE, TILE, TILE, z.floor[(x + y) % 2]!);
    }
    if (z.id !== 'hall') frame(p, z.x * TILE, z.y * TILE, z.w * TILE, z.h * TILE, shade(z.floor[0], -0.12));
  }
  for (const z of ZONES) {
    const sign = SIGNS[z.id];
    if (sign) text(p, z.label, sign[0] * TILE, sign[1] * TILE + 4, 5, 'rgba(31, 27, 46, 0.55)', 'left');
  }
  // Door mat at the entrance.
  px(p, 15 * TILE, 16 * TILE + 4, 2 * TILE, 10, '#8c6d4f');
  frame(p, 15 * TILE, 16 * TILE + 4, 2 * TILE, 10, '#6e543c');
}

function drawWall(p: Painter, sim: OfficeSim): void {
  px(p, 0, 0, WORLD_W, 2 * TILE, PALETTE.wall);
  px(p, 0, 0, WORLD_W, 5, PALETTE.wallTop);
  px(p, 0, 2 * TILE - 3, WORLD_W, 3, PALETTE.wallTrim);
  px(p, 0, 0, TILE, WORLD_H, PALETTE.wall);
  px(p, WORLD_W - TILE, 0, TILE, WORLD_H, PALETTE.wall);
  px(p, TILE - 2, 2 * TILE, 2, WORLD_H - 3 * TILE, PALETTE.wallTrim);
  px(p, WORLD_W - TILE, 2 * TILE, 2, WORLD_H - 3 * TILE, PALETTE.wallTrim);

  for (const x of [9, 16, 29]) drawWindow(p, x * TILE + 2, 7, sim.now);
  drawWhiteboard(p, 12 * TILE, 6);
  drawKanban(p, sim);
  // Help sign blinks while someone is waiting for an answer.
  const waiting = (sim.stats.blocked ?? 0) > 0 && Math.floor(sim.now * 2) % 2 === 0;
  px(p, 26 * TILE + 4, 8, 22, 18, waiting ? PALETTE.orange : PALETTE.yellow);
  frame(p, 26 * TILE + 4, 8, 22, 18, PALETTE.outline);
  text(p, '?', 26 * TILE + 15, 22, 12, PALETTE.outline, 'center');
  drawClock(p, 23 * TILE + 8, 15, sim.now);
}

function drawWindow(p: Painter, x: number, y: number, t: number): void {
  const W = 28;
  const H = 18;
  px(p, x - 1, y - 1, W + 2, H + 2, PALETTE.wallTrim);
  px(p, x, y, W, H, PALETTE.window);
  // The cloud drifts across and comes back round; only the part behind the glass is drawn.
  const drift = (t * 3) % (W + 8);
  for (const shift of [0, -(W + 8)]) {
    const cx = x + drift + shift;
    glass(p, cx, y + 5, 8, 3, x, W);
    glass(p, cx + 2, y + 3, 5, 2, x, W);
  }
  px(p, x + 13, y, 2, 18, PALETTE.wallTrim);
  px(p, x, y + 8, 28, 1, PALETTE.wallTrim);
}

/** A cloud piece clipped to the window pane [left, left + width). */
function glass(p: Painter, x: number, y: number, w: number, h: number, left: number, width: number): void {
  x = Math.round(x);
  const from = Math.max(x, left);
  const to = Math.min(x + w, left + width);
  if (to > from) px(p, from, y, to - from, h, PALETTE.windowShine);
}

function drawWhiteboard(p: Painter, x: number, y: number): void {
  px(p, x - 2, y - 2, 3 * TILE + 4, 22, PALETTE.metalDark);
  px(p, x, y, 3 * TILE, 18, PALETTE.white);
  frame(p, x + 4, y + 4, 10, 6, PALETTE.blue);
  frame(p, x + 20, y + 4, 10, 6, PALETTE.red);
  px(p, x + 14, y + 7, 6, 1, PALETTE.outline);
  px(p, x + 34, y + 5, 8, 1, PALETTE.green);
  px(p, x + 34, y + 8, 10, 1, PALETTE.green);
  px(p, x + 34, y + 11, 6, 1, PALETTE.green);
}

/** The sprint board shows a sticky note per item in each stage (up to 6). */
function drawKanban(p: Painter, sim: OfficeSim): void {
  const x = 19 * TILE;
  const y = 4;
  px(p, x - 2, y - 2, 4 * TILE + 4, 26, PALETTE.woodDark);
  px(p, x, y, 4 * TILE, 22, '#f3ead6');
  const columns = ['todo', 'in_progress', 'review', 'testing', 'done'] as const;
  const colors = [PALETTE.yellow, PALETTE.cyan, PALETTE.purple, PALETTE.pink, PALETTE.green];
  const colW = (4 * TILE) / columns.length;
  columns.forEach((c, i) => {
    const cx = x + i * colW;
    if (i > 0) px(p, cx, y + 1, 1, 20, '#d8ccb1');
    const n = Math.min(6, sim.stats[c] ?? 0);
    for (let k = 0; k < n; k++) px(p, cx + 2 + (k % 2) * 5, y + 3 + Math.floor(k / 2) * 6, 4, 4, colors[i]!);
  });
}

function drawClock(p: Painter, cx: number, cy: number, t: number): void {
  px(p, cx - 6, cy - 6, 12, 12, PALETTE.outline);
  px(p, cx - 5, cy - 5, 10, 10, PALETTE.white);
  const a = (t / 60) * Math.PI * 2;
  px(p, cx + Math.round(Math.sin(a) * 3), cy - Math.round(Math.cos(a) * 3), 1, 1, PALETTE.red);
  px(p, cx, cy - 3, 1, 3, PALETTE.outline);
  px(p, cx, cy, 2, 1, PALETTE.outline);
}

function drawFrontWall(p: Painter): void {
  const y = (ROWS - 1) * TILE;
  px(p, 0, y, WORLD_W, TILE, PALETTE.wall);
  px(p, 0, y, WORLD_W, 3, PALETTE.wallTrim);
  // Entrance door
  px(p, 15 * TILE, y, 2 * TILE, TILE, '#4b3a2a');
  px(p, 15 * TILE + 2, y + 3, 2 * TILE - 4, TILE - 3, '#6b5038');
  px(p, 16 * TILE - 1, y + 3, 2, TILE - 3, '#4b3a2a');
  text(p, 'LOOP CODER HQ', 4 * TILE, y + 11, 6, PALETTE.white, 'center');
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/** How many characters are at the console or arcade right now (not just walking there). */
function playersAt(sim: OfficeSim, kind: 'console' | 'arcade'): number {
  let n = 0;
  for (const w of sim.walkers.values()) if (w.pastime?.kind === kind && w.path.length === 0) n++;
  return n;
}

/** Whether someone has arrived for a pastime of this kind (to animate the furniture they use). */
function pastimeHere(sim: OfficeSim, kind: string): boolean {
  for (const w of sim.walkers.values()) if (w.pastime?.kind === kind && w.pastime.arrived && w.path.length === 0) return true;
  return false;
}

function objectActive(sim: OfficeSim, id: string): boolean {
  return (sim.objects.get(id)?.until ?? 0) > sim.now;
}

function stationBusy(sim: OfficeSim, f: Furniture): boolean {
  if (!f.station) return false;
  const cx = (f.x + f.w / 2) * TILE;
  const here = (s: StationId | null) => s === f.station || (s === 'dev_desk' && WORKSHOP_DESKS.has(f.station!));
  return [...sim.walkers.values()].some((w) => here(w.station) && w.working && w.path.length === 0 && Math.abs(w.x - cx) <= TILE * 1.5);
}

function drawFurniture(p: Painter, f: Furniture, sim: OfficeSim): void {
  const X = f.x * TILE;
  const Y = f.y * TILE;
  const W = f.w * TILE;
  const H = f.h * TILE;
  const t = sim.now;
  switch (f.kind) {
    case 'shelf': {
      px(p, X, Y - 14, W, H + 14, PALETTE.woodDark);
      for (let s = 0; s < 3; s++) {
        const sy = Y - 12 + s * 9;
        px(p, X + 2, sy + 7, W - 4, 2, PALETTE.wood);
        for (let b = 0; b < W - 6; b += 4) {
          const color = [PALETTE.red, PALETTE.blue, PALETTE.green, PALETTE.yellow, PALETTE.purple, PALETTE.orange][(b / 4 + s * 3) % 6]!;
          px(p, X + 3 + b, sy + 1 + ((b / 4 + s) % 2), 3, 6 - ((b / 4 + s) % 2), color);
        }
      }
      break;
    }
    case 'desk': {
      px(p, X, Y - 2, W, 10, PALETTE.woodLight);
      px(p, X, Y + 8, W, 6, PALETTE.wood);
      px(p, X + 1, Y + 14, 2, 2, PALETTE.woodDark);
      px(p, X + W - 3, Y + 14, 2, 2, PALETTE.woodDark);
      // Monitor: scrolling code while someone is working here.
      const mx = X + W / 2 - 7;
      px(p, mx, Y - 11, 14, 10, PALETTE.outline);
      px(p, mx + 1, Y - 10, 12, 8, PALETTE.screen);
      if (stationBusy(sim, f)) {
        const offset = Math.floor(t * 6);
        for (let l = 0; l < 4; l++) {
          const len = 3 + ((hash(`${f.id}${l + offset}`) >>> 3) % 8);
          px(p, mx + 2 + (l % 2) * 2, Y - 9 + l * 2, Math.min(10, len), 1, [PALETTE.green, PALETTE.cyan, PALETTE.yellow, PALETTE.pink][(l + offset) % 4]!);
        }
      }
      px(p, mx + 6, Y - 1, 2, 2, PALETTE.metalDark);
      px(p, X + 3, Y + 2, 5, 3, PALETTE.paper);
      break;
    }
    case 'table': {
      px(p, X - 2, Y - 2, W + 4, H, PALETTE.woodLight);
      px(p, X - 2, Y + H - 2, W + 4, 5, PALETTE.wood);
      frame(p, X - 2, Y - 2, W + 4, H + 3, PALETTE.woodDark);
      for (let i = 0; i < 4; i++) px(p, X + 8 + i * 18, Y + 6 + (i % 2) * 8, 7, 5, PALETTE.paper);
      px(p, X + 30, Y + 13, 4, 4, PALETTE.white);
      px(p, X + 30, Y + 13, 4, 1, PALETTE.woodDark);
      break;
    }
    case 'counter': {
      px(p, X, Y - 4, W, 8, PALETTE.white);
      px(p, X, Y + 4, W, 11, '#e5d3a1');
      px(p, X, Y + 4, W, 1, shade('#e5d3a1', -0.2));
      // Bell
      const shake = objectActive(sim, 'bell') ? Math.round(Math.sin(t * 50)) : 0;
      px(p, 27 * TILE + 4 + shake, Y - 6, 8, 4, PALETTE.yellow);
      px(p, 27 * TILE + 7 + shake, Y - 8, 2, 2, PALETTE.yellow);
      px(p, 27 * TILE + 3, Y - 2, 10, 1, PALETTE.woodDark);
      break;
    }
    case 'whiteboardStand': {
      px(p, X + 3, Y + 6, 2, 10, PALETTE.metalDark);
      px(p, X + W - 5, Y + 6, 2, 10, PALETTE.metalDark);
      px(p, X, Y - 14, W, 20, PALETTE.metalDark);
      px(p, X + 1, Y - 13, W - 2, 18, PALETTE.white);
      frame(p, X + 4, Y - 10, 8, 6, PALETTE.blue);
      frame(p, X + 18, Y - 10, 8, 6, PALETTE.blue);
      px(p, X + 12, Y - 7, 6, 1, PALETTE.blue);
      px(p, X + 15, Y - 4, 1, 5, PALETTE.blue);
      frame(p, X + 11, Y + 0, 10, 4, PALETTE.red);
      if (pastimeHere(sim, 'whiteboard')) {
        const n = Math.floor(t * 3) % 8;
        for (let i = 0; i <= n; i++) px(p, X + 5 + i * 3, Y - 2 + ((i * 5) % 3), 2, 1, PALETTE.green);
      }
      break;
    }
    case 'easel': {
      px(p, X + 3, Y - 6, 2, 22, PALETTE.wood);
      px(p, X + 11, Y - 6, 2, 22, PALETTE.wood);
      px(p, X + 1, Y - 12, 14, 12, PALETTE.paper);
      frame(p, X + 1, Y - 12, 14, 12, PALETTE.woodDark);
      px(p, X + 3, Y - 10, 5, 4, PALETTE.cyan);
      px(p, X + 8, Y - 7, 5, 4, PALETTE.pink);
      px(p, X + 5, Y - 5, 4, 3, PALETTE.yellow);
      break;
    }
    case 'server': {
      const fast = objectActive(sim, 'servers');
      px(p, X, Y - 6, W, H + 6, '#2b3040');
      frame(p, X, Y - 6, W, H + 6, PALETTE.outline);
      for (let r = 0; r < 6; r++) {
        const ry = Y - 3 + r * 6;
        px(p, X + 3, ry, W - 6, 4, '#3a4156');
        for (let l = 0; l < 3; l++) {
          const on = (hash(`${r}${l}${Math.floor(t * (fast ? 14 : 3))}`) & 3) !== 0;
          px(p, X + W - 8 + l * 2, ry + 1, 1, 1, on ? (l === 2 ? PALETTE.yellow : PALETTE.green) : '#1b1f2a');
        }
      }
      break;
    }
    case 'bench': {
      px(p, X, Y - 2, W, 9, PALETTE.white);
      px(p, X, Y + 7, W, 8, PALETTE.metal);
      const busy = [...sim.walkers.values()].some((w) => w.station === 'qa' && w.working && w.path.length === 0);
      const colors = [PALETTE.green, PALETTE.pink, PALETTE.cyan];
      colors.forEach((c, i) => {
        const fx = X + 6 + i * 14;
        px(p, fx, Y - 8, 6, 8, shade(PALETTE.window, 0.3));
        px(p, fx + 1, Y - 4, 4, 4, c);
        px(p, fx + 2, Y - 11, 2, 3, shade(PALETTE.window, 0.3));
        if (busy && Math.floor(t * 4 + i) % 3 === 0) px(p, fx + 2, Y - 14 - ((t * 10 + i * 3) % 4), 1, 1, c);
      });
      break;
    }
    case 'sofa': {
      px(p, X - 2, Y - 6, W + 4, 8, '#3f6fb5');
      px(p, X - 2, Y + 2, W + 4, 10, '#4a80cc');
      px(p, X - 4, Y - 2, 4, 14, '#335d99');
      px(p, X + W, Y - 2, 4, 14, '#335d99');
      for (let i = 1; i < f.w; i++) px(p, X + i * TILE, Y + 2, 1, 8, '#335d99');
      break;
    }
    case 'coffee': {
      px(p, X + 2, Y - 10, 12, 24, '#3a3a46');
      px(p, X + 4, Y - 7, 8, 5, '#5a5a6a');
      px(p, X + 5, Y + 3, 6, 6, PALETTE.white);
      px(p, X + 11, Y - 6, 1, 1, objectActive(sim, 'coffee') ? PALETTE.red : PALETTE.green);
      if (objectActive(sim, 'coffee')) {
        for (let s = 0; s < 3; s++) {
          const sy = Y - 2 - ((t * 14 + s * 5) % 16);
          px(p, X + 6 + Math.round(Math.sin(t * 6 + s) * 2), sy, 2, 2, 'rgba(255,255,255,0.7)');
        }
      }
      break;
    }
    case 'water': {
      px(p, X + 3, Y - 2, 10, 16, PALETTE.white);
      px(p, X + 4, Y - 13, 8, 11, '#7cc4f2');
      px(p, X + 5, Y - 12, 2, 8, PALETTE.windowShine);
      if (objectActive(sim, 'water')) for (let b = 0; b < 3; b++) px(p, X + 6 + b * 2, Y - 3 - ((t * 20 + b * 4) % 9), 1, 1, PALETTE.white);
      break;
    }
    case 'plant': {
      const wiggle = objectActive(sim, f.id) ? Math.round(Math.sin(t * 30)) : 0;
      px(p, X + 4, Y + 6, 8, 9, PALETTE.pot);
      px(p, X + 4, Y + 6, 8, 2, shade(PALETTE.pot, 0.2));
      px(p, X + 3 + wiggle, Y - 6, 10, 12, PALETTE.plant);
      px(p, X + 1 + wiggle, Y - 2, 4, 6, PALETTE.plantDark);
      px(p, X + 11 + wiggle, Y - 3, 4, 6, PALETTE.plantDark);
      px(p, X + 6 + wiggle, Y - 9, 4, 4, PALETTE.plant);
      break;
    }
    case 'printer': {
      const jammed = objectActive(sim, 'printer');
      px(p, X + 1, Y - 4, 14, 14, '#d7d9de');
      px(p, X + 1, Y + 10, 14, 4, '#b5b8c0');
      px(p, X + 3, Y - 6, 10, 3, PALETTE.paper);
      px(p, X + 11, Y - 1, 2, 1, jammed && Math.floor(t * 6) % 2 === 0 ? PALETTE.red : PALETTE.green);
      if (jammed) px(p, X + 4, Y + 4, 8, 6 + Math.round(Math.sin(t * 20)), PALETTE.paper);
      break;
    }
    case 'duckDesk': {
      px(p, X, Y - 2, W, 10, PALETTE.woodLight);
      px(p, X, Y + 8, W, 6, PALETTE.wood);
      const hop = objectActive(sim, 'duck') ? Math.round(Math.abs(Math.sin(t * 18)) * 4) : 0;
      const dx = 14 * TILE + 4;
      px(p, dx, Y - 4 - hop, 8, 5, PALETTE.yellow);
      px(p, dx + 5, Y - 8 - hop, 4, 4, PALETTE.yellow);
      px(p, dx + 9, Y - 6 - hop, 2, 1, PALETTE.orange);
      px(p, dx + 7, Y - 7 - hop, 1, 1, PALETTE.outline);
      break;
    }
    case 'trophies': {
      px(p, X, Y - 10, W, 24, PALETTE.woodDark);
      px(p, X + 2, Y - 8, W - 4, 2, PALETTE.wood);
      px(p, X + 2, Y + 4, W - 4, 2, PALETTE.wood);
      const done = Math.min(8, sim.stats.done ?? 0);
      for (let i = 0; i < 8; i++) {
        const tx = X + 4 + (i % 4) * 15;
        const ty = i < 4 ? Y - 8 : Y + 4;
        if (i < done) {
          px(p, tx + 2, ty - 7, 6, 5, PALETTE.yellow);
          px(p, tx + 4, ty - 2, 2, 1, PALETTE.yellow);
          px(p, tx + 3, ty - 1, 4, 1, shade(PALETTE.yellow, -0.3));
          px(p, tx + 3, ty - 6, 1, 2, PALETTE.windowShine);
          if (objectActive(sim, 'trophies') && Math.floor(t * 4 + i) % 4 === 0) {
            px(p, tx + 6, ty - 9, 1, 3, PALETTE.white);
            px(p, tx + 5, ty - 8, 3, 1, PALETTE.white);
          }
        } else {
          px(p, tx + 3, ty - 2, 4, 1, shade(PALETTE.woodDark, -0.2));
        }
      }
      break;
    }
    case 'gong': {
      const ring = objectActive(sim, 'gong') ? Math.round(Math.sin(t * 40)) : 0;
      px(p, X + 1, Y - 14, 2, 28, PALETTE.woodDark);
      px(p, X + 13, Y - 14, 2, 28, PALETTE.woodDark);
      px(p, X + 1, Y - 15, 14, 2, PALETTE.woodDark);
      px(p, X + 3 + ring, Y - 10, 10, 12, '#d39b3a');
      px(p, X + 5 + ring, Y - 8, 6, 8, '#e8b85a');
      px(p, X + 7 + ring, Y - 6, 2, 4, '#d39b3a');
      break;
    }
    case 'tv': {
      // A TV on a low cabinet; the screen plays a game while someone holds a controller.
      const playing = playersAt(sim, 'console') > 0 || objectActive(sim, 'tv');
      px(p, X + 1, Y + 4, W - 2, 10, PALETTE.woodDark);
      px(p, X + 3, Y + 6, W - 6, 2, PALETTE.wood);
      px(p, X + 4, Y - 12, W - 8, 15, PALETTE.outline);
      px(p, X + 5, Y - 11, W - 10, 13, playing ? '#1b1f3a' : PALETTE.screen);
      if (playing) {
        const f = Math.floor(t * 8);
        px(p, X + 6, Y - 1, W - 12, 2, PALETTE.green);
        px(p, X + 8 + (f % 12), Y - 4, 3, 3, PALETTE.yellow);
        px(p, X + W - 12 - ((f * 2) % 10), Y - 8, 2, 2, PALETTE.red);
        px(p, X + 10 + ((f * 3) % 8), Y - 9, 1, 1, PALETTE.white);
      }
      px(p, X + 8, Y + 9, 6, 3, '#2b2f3a');
      px(p, X + 9, Y + 10, 1, 1, playing ? PALETTE.green : PALETTE.metalDark);
      break;
    }
    case 'arcade': {
      const playing = playersAt(sim, 'arcade') > 0 || objectActive(sim, 'arcade');
      px(p, X + 2, Y - 14, 12, 28, PALETTE.purple);
      px(p, X + 2, Y - 14, 12, 3, PALETTE.pink);
      px(p, X + 4, Y - 10, 8, 8, PALETTE.outline);
      px(p, X + 5, Y - 9, 6, 6, playing ? PALETTE.cyan : PALETTE.screen);
      if (playing) {
        const f = Math.floor(t * 10);
        px(p, X + 5 + (f % 5), Y - 8 + ((f >> 1) % 4), 2, 2, PALETTE.yellow);
        px(p, X + 9 - (f % 4), Y - 5, 1, 1, PALETTE.red);
      }
      px(p, X + 3, Y, 10, 4, shade(PALETTE.purple, -0.25));
      px(p, X + 5, Y + 1, 2, 2, PALETTE.red);
      px(p, X + 9, Y + 1, 1, 1, PALETTE.yellow);
      px(p, X + 11, Y + 2, 1, 1, PALETTE.green);
      break;
    }
    case 'crates': {
      px(p, X + 1, Y - 2, 14, 16, PALETTE.woodLight);
      frame(p, X + 1, Y - 2, 14, 16, PALETTE.woodDark);
      px(p, X + 1, Y + 5, 14, 1, PALETTE.woodDark);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** Pastimes where hands keep busy: games, sketching, checking servers, polishing trophies. */
const HANDS_BUSY = new Set(['console', 'arcade', 'whiteboard', 'easel', 'servers', 'trophies']);
/** What a character holds during a pastime. */
const PASTIME_PROPS: Partial<Record<string, Walker['look']['prop']>> = { coffee: 'mug', plants: 'wateringcan', reading: 'book' };

/** The sofa seat of a napper who has sat down. */
function seatOf(w: Walker): { x: number; y: number } | null {
  return w.pastime?.kind === 'nap' && w.pastime.arrived && w.path.length === 0 ? (w.pastime.spot.seat ?? null) : null;
}
const seatFeet = (seat: { x: number; y: number }) => ({ x: seat.x * TILE + TILE / 2, y: seat.y * TILE + 8 });

function drawWalker(p: Painter, w: Walker, sim: OfficeSim, hovered: boolean): void {
  const walking = w.path.length > 0;
  const shake = w.shakeUntil > sim.now ? Math.round(Math.sin(sim.now * 60) * 1.5) : 0;
  const atDesk = !walking && w.working && w.spot?.face === 'up' && w.station !== 'meeting' && w.station !== 'kanban' && w.station !== 'dock';
  const busyHands = !walking && Boolean(w.pastime && HANDS_BUSY.has(w.pastime.kind));
  const prop = !walking && w.pastime ? PASTIME_PROPS[w.pastime.kind] : undefined;
  const look = prop ? { ...w.look, prop } : w.look;
  const seat = seatOf(w);
  const at = seat ? seatFeet(seat) : { x: w.x, y: w.y };
  if (hovered) px(p, at.x - 7, at.y - 1, 14, 3, 'rgba(255, 255, 255, 0.55)');
  drawCharacter(p, look, at.x, at.y, {
    dir: seat ? 'down' : w.dir,
    frame: walking ? Math.floor(w.walked / 4) % 4 : 0,
    working: atDesk || busyHands,
    shake,
    grumpy: w.emote?.kind === 'anger',
    hop: w.emote?.kind === 'sparkle' || w.hopUntil > sim.now ? Math.round(Math.abs(Math.sin(sim.now * 12)) * 2) : 0,
  });
  // Seated: the front of the sofa cushion hides the legs.
  if (seat) {
    px(p, at.x - 7, seat.y * TILE + 2, 14, 10, '#4a80cc');
    px(p, at.x - 7, seat.y * TILE + 2, 14, 1, shade('#4a80cc', 0.15));
  }
}

/** Little extras of some pastimes: water from the can, a bug fluttering ahead of the net. */
function drawPastimeEffect(p: Painter, w: Walker, t: number): void {
  const pt = w.pastime;
  if (!pt?.arrived || w.path.length > 0) return;
  if (pt.kind === 'plants') {
    // Drops from the can onto the plant beside or below the character.
    const dx = w.dir === 'left' ? -12 : w.dir === 'right' ? 12 : 4;
    const top = w.dir === 'down' ? w.y - 8 : w.y - 16;
    for (let i = 0; i < 3; i++) {
      const fall = (t * 18 + i * 5) % 12;
      px(p, w.x + dx - 2 + i * 2, top + fall, 1, 2, PALETTE.blue);
    }
  } else if (pt.kind === 'bughunt') {
    const bx = w.x + Math.round(Math.sin(t * 3.1) * 12);
    const by = w.y - 20 + Math.round(Math.cos(t * 4.3) * 5);
    const flap = Math.floor(t * 16) % 2;
    px(p, bx, by, 2, 2, PALETTE.outline);
    px(p, bx - 1, by - 1 - flap, 1, 1, PALETTE.windowShine);
    px(p, bx + 2, by - 1 - flap, 1, 1, PALETTE.windowShine);
  }
}

function drawEmote(p: Painter, kind: Emote, x: number, y: number, t: number): void {
  const bob = Math.round(Math.sin(t * 6));
  const X = Math.round(x) - 4;
  const Y = Math.round(y) - 8 + bob;
  const box = (color: string) => {
    px(p, X - 1, Y - 1, 10, 10, PALETTE.outline);
    px(p, X, Y, 8, 8, color);
  };
  switch (kind) {
    case 'alert':
      box(PALETTE.white);
      px(p, X + 3, Y + 1, 2, 4, PALETTE.red);
      px(p, X + 3, Y + 6, 2, 1, PALETTE.red);
      break;
    case 'question':
      box(PALETTE.white);
      px(p, X + 2, Y + 1, 4, 1, PALETTE.blue);
      px(p, X + 5, Y + 2, 1, 2, PALETTE.blue);
      px(p, X + 3, Y + 4, 2, 1, PALETTE.blue);
      px(p, X + 3, Y + 6, 2, 1, PALETTE.blue);
      break;
    case 'anger':
      px(p, X + 1, Y + 1, 2, 2, PALETTE.red);
      px(p, X + 5, Y + 1, 2, 2, PALETTE.red);
      px(p, X + 1, Y + 5, 2, 2, PALETTE.red);
      px(p, X + 5, Y + 5, 2, 2, PALETTE.red);
      px(p, X + 3, Y + 3, 2, 2, PALETTE.red);
      break;
    case 'sweat':
      px(p, X + 5, Y + 1, 2, 2, PALETTE.cyan);
      px(p, X + 4, Y + 3, 4, 3, PALETTE.cyan);
      break;
    case 'sleep': {
      const rise = Math.floor((t * 2) % 3);
      text(p, 'z', X + 2 + rise, Y + 6 - rise * 2, 6, PALETTE.white, 'left');
      break;
    }
    case 'heart':
      px(p, X + 1, Y + 1, 2, 2, PALETTE.pink);
      px(p, X + 5, Y + 1, 2, 2, PALETTE.pink);
      px(p, X + 1, Y + 2, 6, 2, PALETTE.pink);
      px(p, X + 2, Y + 4, 4, 1, PALETTE.pink);
      px(p, X + 3, Y + 5, 2, 1, PALETTE.pink);
      break;
    case 'sparkle':
      for (let i = 0; i < 4; i++) {
        const a = t * 5 + (i * Math.PI) / 2;
        px(p, X + 3 + Math.round(Math.cos(a) * 6), Y + 4 + Math.round(Math.sin(a) * 6), 2, 2, PALETTE.yellow);
      }
      break;
    case 'dots':
      box(PALETTE.white);
      for (let i = 0; i < 3; i++) if (Math.floor(t * 3) % 4 > i) px(p, X + 1 + i * 2 + i, Y + 4, 1, 1, PALETTE.outline);
      break;
  }
}

const TAG_COLORS = {
  idle: 'rgba(31, 27, 46, 0.55)',
  active: 'rgba(31, 27, 46, 0.85)',
  agent: 'rgba(109, 74, 255, 0.9)',
  human: 'rgba(46, 125, 72, 0.85)',
} as const;

const TAG_SIZE = 5;
/** Height of one tag line, gap included. */
export const TAG_LINE = 9;

export interface NameTag {
  /** The role's name, then the agent playing it (if any), one under the other. */
  lines: Array<{ text: string; style: keyof typeof TAG_COLORS }>;
  x: number;
  y: number;
}

/**
 * Lay name tags out so they never cover each other: each tag goes where it belongs, or as many
 * lines lower as needed (at most two) when a tag placed before it is in the way. Lines of one tag
 * stay together. Returns every line to draw.
 */
export function placeNameTags(tags: NameTag[], widthOf: (text: string) => number): Array<{ text: string; x: number; y: number; style: keyof typeof TAG_COLORS }> {
  const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const out: Array<{ text: string; x: number; y: number; style: keyof typeof TAG_COLORS }> = [];
  const height = TAG_SIZE + 3;
  for (const tag of [...tags].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const boxes = (drop: number) =>
      tag.lines.map((l, i) => {
        const w = widthOf(l.text);
        const top = tag.y + drop + i * (TAG_LINE - 1);
        return { left: tag.x - w / 2, right: tag.x + w / 2, top, bottom: top + height };
      });
    const clear = (bs: ReturnType<typeof boxes>) => bs.every((b) => placed.every((o) => b.right <= o.left || b.left >= o.right || b.bottom <= o.top || b.top >= o.bottom));
    let drop = 0;
    while (drop < 2 * TAG_LINE && !clear(boxes(drop))) drop += TAG_LINE;
    boxes(drop).forEach((b, i) => {
      placed.push(b);
      out.push({ text: tag.lines[i]!.text, x: tag.x, y: b.top, style: tag.lines[i]!.style });
    });
  }
  return out;
}

function drawNameTag(p: Painter, name: string, x: number, y: number, style: keyof typeof TAG_COLORS): void {
  const width = measure(p, name, TAG_SIZE) + 4;
  px(p, x - width / 2, y, width, TAG_SIZE + 3, TAG_COLORS[style]);
  text(p, name, x, y + TAG_SIZE + 1, TAG_SIZE, PALETTE.white, 'center');
}

function drawCursor(p: Painter, x: number, y: number, t: number): void {
  const bob = Math.round(Math.abs(Math.sin(t * 5)) * 2);
  const X = Math.round(x) - 3;
  const Y = Math.round(y) - 9 - bob;
  px(p, X, Y, 7, 2, PALETTE.white);
  px(p, X + 1, Y + 2, 5, 1, PALETTE.white);
  px(p, X + 2, Y + 3, 3, 1, PALETTE.white);
  px(p, X + 3, Y + 4, 1, 1, PALETTE.white);
  frame(p, X - 1, Y - 1, 9, 3, PALETTE.outline);
}

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

const BUBBLE_STYLE: Record<Bubble['tone'], { fill: string; border: string }> = {
  say: { fill: PALETTE.white, border: PALETTE.outline },
  question: { fill: '#e3f1ff', border: PALETTE.blue },
  answer: { fill: '#e2f6e6', border: '#2e7d48' },
  shout: { fill: '#fff4d6', border: PALETTE.red },
  object: { fill: '#fff8e8', border: '#8c6d4f' },
};

function drawBubble(p: Painter, sim: OfficeSim, b: Bubble, speed: RenderOptions['textSpeed']): void {
  const anchor = sim.anchorOf(b.ownerId);
  if (!anchor) return;
  const size = 6;
  const cps = TEXT_CPS[speed];
  const shown = Number.isFinite(cps) ? b.text.slice(0, Math.max(1, Math.floor((sim.now - b.started) * cps))) : b.text;
  const lines = wrap(p, b.text, 112, size).slice(0, 4);
  // Lay out with the full text so the bubble does not grow while typing.
  const width = Math.max(...lines.map((l) => measure(p, l, size))) + 8;
  const height = lines.length * (size + 2) + 5;
  const x = Math.max(2, Math.min(WORLD_W - width - 2, anchor.x - width / 2));
  const y = Math.max(2, anchor.y - height - 4);
  const style = BUBBLE_STYLE[b.tone];
  px(p, x, y, width, height, style.border);
  px(p, x + 1, y + 1, width - 2, height - 2, style.fill);
  // Tail
  const tx = Math.max(x + 3, Math.min(x + width - 6, anchor.x - 2));
  px(p, tx, y + height - 1, 4, 1, style.fill);
  px(p, tx + 1, y + height, 2, 2, style.border);
  let remaining = shown.length;
  lines.forEach((line, i) => {
    const visible = line.slice(0, Math.max(0, remaining));
    remaining -= line.length + 1;
    text(p, visible, x + 4, y + 3 + (i + 1) * (size + 2) - 2, size, PALETTE.outline, 'left');
  });
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function font(p: Painter, size: number): void {
  p.ctx.font = `${size * p.scale}px ${FONT_FAMILY}`;
}

function measure(p: Painter, s: string, size: number): number {
  font(p, size);
  return p.ctx.measureText(s).width / p.scale;
}

export function text(p: Painter, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign): void {
  font(p, size);
  p.ctx.textAlign = align;
  p.ctx.textBaseline = 'alphabetic';
  p.ctx.fillStyle = color;
  p.ctx.fillText(s, Math.round(x * p.scale), Math.round(y * p.scale));
}

/** Word-wrap to a width in world pixels. */
export function wrap(p: Painter, s: string, maxWidth: number, size: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measure(p, next, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 4) lines[3] = `${lines[3]!.slice(0, Math.max(0, lines[3]!.length - 1))}…`;
  return lines;
}

