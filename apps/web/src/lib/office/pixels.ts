// Pixel-art basics for the agent office: a world measured in 16 px tiles, drawn at an integer
// scale so every pixel stays crisp.

export const TILE = 16;
export const COLS = 32;
export const ROWS = 18;
export const WORLD_W = COLS * TILE; // 512
export const WORLD_H = ROWS * TILE; // 288

/** Draws in world pixels; the canvas itself is `scale` times larger. */
export interface Painter {
  ctx: CanvasRenderingContext2D;
  scale: number;
  /** Seconds since the office opened, for idle animations. */
  time: number;
}

export function px(p: Painter, x: number, y: number, w: number, h: number, color: string): void {
  p.ctx.fillStyle = color;
  p.ctx.fillRect(Math.round(x) * p.scale, Math.round(y) * p.scale, Math.round(w) * p.scale, Math.round(h) * p.scale);
}

/** Outline-only rectangle, one world pixel thick. */
export function frame(p: Painter, x: number, y: number, w: number, h: number, color: string): void {
  px(p, x, y, w, 1, color);
  px(p, x, y + h - 1, w, 1, color);
  px(p, x, y, 1, h, color);
  px(p, x + w - 1, y, 1, h, color);
}

/** Lighten (amount > 0) or darken (amount < 0) a #rrggbb colour. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = Number.parseInt(m[1]!, 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return `#${[16, 8, 0].map((s) => channel(s).toString(16).padStart(2, '0')).join('')}`;
}

/** A stable 32-bit hash, so the same name or role always gets the same look. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const pick = <T,>(list: readonly T[], seed: number): T => list[seed % list.length]!;

/** A valid #rrggbb colour or the fallback (role colours come from the database). */
export function safeColor(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export const PALETTE = {
  outline: '#1f1b2e',
  wallTop: '#3b3355',
  wall: '#5b4f7d',
  wallTrim: '#2a2440',
  window: '#9fd8ff',
  windowShine: '#e6f6ff',
  floor: '#d9c9a8',
  floorLine: '#c9b893',
  wood: '#a86b3c',
  woodDark: '#7a4a28',
  woodLight: '#c98c55',
  metal: '#8e95a6',
  metalDark: '#5c6273',
  screen: '#1d2433',
  white: '#f4f1e8',
  paper: '#fffaf0',
  shadow: 'rgba(20, 16, 40, 0.28)',
  plant: '#4caf6a',
  plantDark: '#2f7d48',
  pot: '#c0603a',
  red: '#e04f5f',
  yellow: '#f5c542',
  blue: '#4a90e2',
  green: '#5cc26f',
  purple: '#8b6dff',
  cyan: '#22c7d8',
  orange: '#f08a3c',
  pink: '#f48fb1',
} as const;
